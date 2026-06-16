package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/skip2/go-qrcode"
	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

var SecretKey string
var AuthSecretKey string
var WeChatAppID string
var WeChatSecret string

var redisClient *redis.Client

type LocalConfig struct {
	SecretKey     string `json:"qr_secret_key"`
	AuthSecretKey string `json:"auth_secret_key"`
	WeChatAppID   string `json:"wechat_appid"`
	WeChatSecret  string `json:"wechat_secret"`
	RedisAddr     string `json:"redis_addr"`
	RedisPassword string `json:"redis_password"`
	RedisDB       int    `json:"redis_db"`
}

// loadLocalConfig 从 config.json 加载本地配置，包含各种密钥信息
func loadLocalConfig() (LocalConfig, bool) {
	paths := []string{"config.json"}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		paths = append(paths, filepath.Join(exeDir, "config.json"))
	}

	var cfg LocalConfig
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(b, &cfg); err != nil {
			return LocalConfig{}, false
		}
		return cfg, true
	}
	return LocalConfig{}, false
}

// mustInitSecrets 处理相关逻辑
func mustInitSecrets() {
	SecretKey = strings.TrimSpace(os.Getenv("QR_SECRET_KEY"))
	AuthSecretKey = strings.TrimSpace(os.Getenv("AUTH_SECRET_KEY"))
	WeChatAppID = strings.TrimSpace(os.Getenv("WECHAT_APPID"))
	WeChatSecret = strings.TrimSpace(os.Getenv("WECHAT_SECRET"))

	if SecretKey == "" || AuthSecretKey == "" {
		if cfg, ok := loadLocalConfig(); ok {
			if SecretKey == "" {
				SecretKey = strings.TrimSpace(cfg.SecretKey)
			}
			if AuthSecretKey == "" {
				AuthSecretKey = strings.TrimSpace(cfg.AuthSecretKey)
			}
			if WeChatAppID == "" {
				WeChatAppID = strings.TrimSpace(cfg.WeChatAppID)
			}
			if WeChatSecret == "" {
				WeChatSecret = strings.TrimSpace(cfg.WeChatSecret)
			}
		}
	}

	if SecretKey == "" || AuthSecretKey == "" {
		log.Fatal("缺少密钥配置：请在 config.json 或环境变量 QR_SECRET_KEY/AUTH_SECRET_KEY 中设置")
	}
}

// --- 数据结构 ---
type QRcode struct {
	Ver  string `json:"ver"`  // 版本号（可选）
	Seat string `json:"seat"` // 座位号
	Room string `json:"room"` // 房间号
	Iat  string `json:"iat"`  // 签发时间（可选，ISO8601字符串）
	Ttl  string `json:"ttl"`  // 有效期（可选，如 "5m" 或 "300"）
	Sig  string `json:"sig"`  //签名
}

// 响应结构
type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data"`
}

type User struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	Username     string `gorm:"unique;not null;type:varchar(191)" json:"username"`
	PasswordHash string `gorm:"not null" json:"-"`
	Role         string `gorm:"not null" json:"role"` // user | org_owner
	OrgID        *uint  `gorm:"index" json:"org_id,omitempty"`
	PendingOrgID *uint  `gorm:"index" json:"pending_org_id,omitempty"`
	OrgStatus    string `gorm:"not null" json:"org_status"` // none | pending | approved
	CreatedAt    time.Time
}

type Organization struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	Name        string `gorm:"unique;not null;type:varchar(191)" json:"name"`
	OwnerUserID uint   `gorm:"not null" json:"owner_user_id"`
	CreatedAt   time.Time
}

// Semester 学期表 (个人私有，user_id 隔离)
type Semester struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	Name      string    `gorm:"not null;type:varchar(191)" json:"name"`
	StartDate time.Time `json:"start_date"` // 学期开始时间 (必须是周一)
	EndDate   time.Time `json:"end_date"`   // 学期结束时间 (必须是周日)
	TimeSlots string    `gorm:"type:longtext" json:"time_slots"`
	CreatedAt time.Time `json:"created_at"`
}

// Course 课程表 (个人私有，user_id 隔离)
type Course struct {
	ID               uint    `gorm:"primaryKey" json:"id"`
	UserID           uint    `gorm:"not null;index" json:"user_id"`
	SemesterID       uint    `gorm:"index" json:"semester_id"` // 关联学期
	Name             string  `gorm:"not null;type:varchar(191)" json:"name"`
	Location         string  `json:"location"`
	DayIndex         int     `json:"dayIndex"`
	StartSlotIndex   int     `json:"startSlotIndex"`
	EndSlotIndex     int     `json:"endSlotIndex"`
	Color            string  `json:"color"`
	MemberMode       string  `json:"memberMode"` // independent | class | all
	ClassRosterID    string  `json:"classRosterId"`
	Members          string  `gorm:"type:longtext" json:"-"`     // JSON 存储成员列表
	Weeks            string  `gorm:"type:longtext" json:"weeks"` // 存储上课周，例如 JSON [1, 2, 3]
	StartWeek        int     `json:"start_week"`                 // 开始周
	EndWeek          int     `json:"end_week"`                   // 结束周
	BSSIDEnabled     bool    `json:"bssid_enabled"`
	BSSIDList        string  `gorm:"type:longtext" json:"bssid_list"`
	GPSEnabled       bool    `json:"gps_enabled"`
	GPSLat           float64 `json:"gps_lat"`
	GPSLng           float64 `json:"gps_lng"`
	GPSRadiusM       int     `json:"gps_radius_m"`
	IPEnabled        bool    `json:"ip_enabled"`
	IPList           string  `gorm:"type:longtext" json:"ip_list"`
	FixedSeatEnabled bool    `json:"fixed_seat_enabled"`
}

type CourseFixedSeat struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CourseID  uint      `gorm:"not null;index;uniqueIndex:uniq_course_student,priority:1;uniqueIndex:uniq_course_seat,priority:1" json:"course_id"`
	StudentID string    `gorm:"not null;type:varchar(64);uniqueIndex:uniq_course_student,priority:2" json:"student_id"`
	SeatLabel string    `gorm:"not null;type:varchar(64);uniqueIndex:uniq_course_seat,priority:2" json:"seat_label"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// distanceMeters 处理相关逻辑
func distanceMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180.0 }
	phi1 := toRad(lat1)
	phi2 := toRad(lat2)
	dPhi := toRad(lat2 - lat1)
	dLam := toRad(lng2 - lng1)
	a := math.Sin(dPhi/2)*math.Sin(dPhi/2) + math.Cos(phi1)*math.Cos(phi2)*math.Sin(dLam/2)*math.Sin(dLam/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return r * c
}

// normalizeBSSIDList 处理相关逻辑
func normalizeBSSIDList(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == ',' || r == ';' || r == '|'
	})
	seen := make(map[string]bool, len(parts))
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return strings.Join(out, "\n")
}

// bssidAllowed 处理相关逻辑
func bssidAllowed(list string, bssid string) bool {
	bssid = strings.ToLower(strings.TrimSpace(bssid))
	if bssid == "" {
		return false
	}
	parts := strings.FieldsFunc(list, func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == ',' || r == ';' || r == '|'
	})
	for _, p := range parts {
		if strings.ToLower(strings.TrimSpace(p)) == bssid {
			return true
		}
	}
	return false
}

func normalizeIPList(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == ',' || r == ';' || r == '|'
	})
	seen := make(map[string]bool, len(parts))
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.Contains(p, "/") {
			_, n, err := net.ParseCIDR(p)
			if err != nil || n == nil {
				continue
			}
			key := n.String()
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, key)
			continue
		}
		ip := net.ParseIP(p)
		if ip == nil {
			continue
		}
		if v4 := ip.To4(); v4 != nil {
			p = v4.String()
		} else {
			p = ip.String()
		}
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return strings.Join(out, "\n")
}

func ipAllowed(list string, rawIP string) bool {
	rawIP = strings.TrimSpace(rawIP)
	if rawIP == "" {
		return false
	}
	ip := net.ParseIP(rawIP)
	if ip == nil {
		return false
	}
	parts := strings.FieldsFunc(strings.TrimSpace(list), func(r rune) bool {
		return r == '\n' || r == '\r' || r == '\t' || r == ' ' || r == ',' || r == ';' || r == '|'
	})
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.Contains(p, "/") {
			_, n, err := net.ParseCIDR(p)
			if err != nil || n == nil {
				continue
			}
			if n.Contains(ip) {
				return true
			}
			continue
		}
		x := net.ParseIP(p)
		if x == nil {
			continue
		}
		if x.Equal(ip) {
			return true
		}
	}
	return false
}

// ClassRoster 班级名单表 (组织共享，org_id 隔离)
type ClassRoster struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	OrgID   uint   `gorm:"not null;index" json:"org_id"`
	Name    string `gorm:"not null;type:varchar(191)" json:"name"`
	Members string `gorm:"type:longtext" json:"-"` // JSON 存储成员列表
}

// 数据库连接信息
const (
	dbUser     = "root"
	dbPassword = "345tufiv"
	dbName     = "sign_in_system"
	dbHost     = "127.0.0.1"
	dbPort     = "3306"
)

type Room struct {
	ID         int    `gorm:"primaryKey"`
	Org_id     *int   `gorm:"index"`                            // 使用指针类型，避免默认填充 0
	Room_id    string `gorm:"not null;type:varchar(191);index"` // 移除 unique，因为不同组织可能有同名房间
	Seat_pos   string `gorm:"not null;type:longtext"`
	Bssid_list string `gorm:"type:varchar(255)"`
}

// SignSession 签到场次表
type SignSession struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CourseID  uint      `gorm:"index" json:"course_id"` // 关联课程
	RoomID    string    `json:"room_id"`                // 关联教室
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"` // 可为空，表示未结束
	IsActive  bool      `json:"is_active"`
}

// SignIn 签到记录表结构
type SignIn struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	SessionID   uint      `gorm:"not null;index;uniqueIndex:uniq_session_student,priority:1;uniqueIndex:uniq_session_seat,priority:1;uniqueIndex:uniq_session_openid,priority:1" json:"session_id"` // 所属签到场次
	StudentID   string    `gorm:"type:varchar(64);uniqueIndex:uniq_session_student,priority:2" json:"student_id"`                                                                                   // 学号 (字符串更通用)
	StudentName string    `gorm:"type:varchar(64)" json:"student_name"`                                                                                                                             // 学生姓名 (冗余存储，方便查询)
	OpenID      *string   `gorm:"type:varchar(64);index;uniqueIndex:uniq_session_openid,priority:2" json:"openid,omitempty"`
	SeatLabel   string    `gorm:"type:varchar(64);uniqueIndex:uniq_session_seat,priority:2" json:"seat_label"` // 座位号 (如 A1)
	Time        time.Time `json:"time"`                                                                        // 签到时间
	Ip          string    `json:"ip"`                                                                          // 签到时ip
	DeviceID    string    `json:"device_id"`                                                                   // 设备指纹/BSSID
	Status      string    `json:"status"`                                                                      // success | fail | late
	SignQuality string    `gorm:"type:varchar(16);not null;default:'ok'" json:"sign_quality"`                  // ok | warn
	WarnReasons string    `gorm:"type:varchar(255)" json:"warn_reasons"`
}

type SignLeave struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	SessionID uint      `gorm:"not null;index;uniqueIndex:uniq_session_leave_student,priority:1" json:"session_id"`
	StudentID string    `gorm:"not null;type:varchar(64);uniqueIndex:uniq_session_leave_student,priority:2" json:"student_id"`
	Reason    string    `gorm:"type:varchar(255)" json:"reason"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SignAnomalyAlert struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	SessionID uint      `gorm:"not null;index;uniqueIndex:uniq_session_student_kind,priority:1" json:"session_id"`
	StudentID string    `gorm:"not null;type:varchar(64);index;uniqueIndex:uniq_session_student_kind,priority:2" json:"student_id"`
	Kind      string    `gorm:"not null;type:varchar(64);uniqueIndex:uniq_session_student_kind,priority:3" json:"kind"`
	Score     float64   `json:"score"`
	Message   string    `gorm:"type:varchar(255)" json:"message"`
	SeatLabel string    `gorm:"type:varchar(64)" json:"seat_label"`
	CreatedAt time.Time `json:"created_at"`
}

// SignAbsenceAlert 缺勤提醒表
type SignAbsenceAlert struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	SessionID  uint      `gorm:"not null;index" json:"session_id"`
	CourseID   uint      `gorm:"not null;index" json:"course_id"`
	StudentID  string    `gorm:"not null;type:varchar(64);index" json:"student_id"`
	OpenID     string    `gorm:"type:varchar(64);index" json:"openid"`
	CourseName string    `gorm:"type:varchar(191)" json:"course_name"`
	Status     string    `gorm:"not null;type:varchar(16);default:'pending'" json:"status"` // pending | sent | read
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// connectDB 函数用于连接数据库
func connectDB() (*gorm.DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		dbUser, dbPassword, dbHost, dbPort, dbName)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	// 自动迁移多个模型
	err = db.AutoMigrate(&Room{}, &User{}, &Organization{}, &Course{}, &CourseFixedSeat{}, &ClassRoster{}, &Semester{}, &SignSession{}, &SignIn{}, &SignLeave{}, &SignAnomalyAlert{}, &SignAbsenceAlert{})
	if err != nil {
		return nil, err
	}

	return db, nil
}

func initRedis() {
	addr := strings.TrimSpace(os.Getenv("REDIS_ADDR"))
	if addr == "" {
		if cfg, ok := loadLocalConfig(); ok {
			addr = strings.TrimSpace(cfg.RedisAddr)
		}
		if addr == "" {
			addr = "127.0.0.1:6379"
		}
	}
	pass := os.Getenv("REDIS_PASSWORD")
	if strings.TrimSpace(pass) == "" {
		if cfg, ok := loadLocalConfig(); ok {
			pass = cfg.RedisPassword
		}
	}
	dbIdx := 0
	if s := strings.TrimSpace(os.Getenv("REDIS_DB")); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			dbIdx = v
		}
	} else {
		if cfg, ok := loadLocalConfig(); ok {
			dbIdx = cfg.RedisDB
		}
	}

	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: pass,
		DB:       dbIdx,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		redisClient = nil
		return
	}
	redisClient = client
}

func cacheKeySessionSignIns(sessionID uint) string {
	return "session:signins:" + strconv.FormatUint(uint64(sessionID), 10)
}

// RoomRequest 用于接收前端创建场地请求的结构体
type RoomRequest struct {
	ID         int         `json:"id"`
	Org_id     *int        `json:"org_id,omitempty"` // 使用指针类型，omitempty 表示如果为 nil 则不序列化
	Room_id    string      `json:"room_id"`
	Seat_pos   interface{} `json:"seat_pos"` // 可以接收对象数组
	Bssid_list string      `json:"bssid_list"`
}

// CreateSignRequest 用于接收前端创建场地请求的结构体
type CreateSignRequest struct {
	ID           int       `json:"id"`
	Org_id       *int      `json:"org_id,omitempty"` // 使用指针类型，omitempty 表示如果为 nil 则不序列化
	Create_time  time.Time `json:"time"`             // 签到时间
	Sign_message string    `json:"sign_message"`
}

// GetRoomByID 根据room_id获取房间信息，特别是seat_pos
func GetRoomByID(db *gorm.DB, c *gin.Context) {
	// 从URL查询参数获取room_id
	roomID := c.Query("room_id")
	if roomID == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要参数: room_id")
		return
	}

	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}

	// 查询数据库 (增加 org_id 过滤)
	var room Room
	result := db.Where("room_id = ? AND org_id = ?", roomID, *claims.OrgID).First(&room)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			errorResponse(c, http.StatusNotFound, "未找到该房间信息")
		} else {
			log.Printf("查询房间失败: %v", result.Error)
			errorResponse(c, http.StatusInternalServerError, "查询房间失败")
		}
		return
	}

	// 将seat_pos从JSON字符串反序列化为原始对象
	var seatPos interface{}
	if room.Seat_pos != "" {
		err := json.Unmarshal([]byte(room.Seat_pos), &seatPos)
		if err != nil {
			log.Printf("反序列化seat_pos失败: %v", err)
			// 如果反序列化失败，仍然返回原始字符串
			seatPos = room.Seat_pos
		}
	}

	// 构建响应数据
	responseData := gin.H{
		"room_id":  room.Room_id,
		"seat_pos": seatPos,
	}

	// 只在Org_id不为nil时返回
	if room.Org_id != nil {
		responseData["org_id"] = *room.Org_id
	}

	// 如果bssid_list不为空也返回
	if room.Bssid_list != "" {
		responseData["bssid_list"] = room.Bssid_list
	}

	successResponse(c, responseData)
}

// GetSignBySession 处理相关逻辑
func GetSignBySession(db *gorm.DB, c *gin.Context) {
	// 从URL查询参数获取room_id
	sign_session := c.Query("sign_session")
	if sign_session == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要参数: sign_session")
		return
	}

	// 查询数据库
	var room Room
	result := db.Where("sign_session = ?", sign_session).First(&room)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			errorResponse(c, http.StatusNotFound, "未找到该房间信息")
		} else {
			log.Printf("查询房间失败: %v", result.Error)
			errorResponse(c, http.StatusInternalServerError, "查询房间失败")
		}
		return
	}

	// 将seat_pos从JSON字符串反序列化为原始对象
	var seatPos interface{}
	if room.Seat_pos != "" {
		err := json.Unmarshal([]byte(room.Seat_pos), &seatPos)
		if err != nil {
			log.Printf("反序列化seat_pos失败: %v", err)
			// 如果反序列化失败，仍然返回原始字符串
			seatPos = room.Seat_pos
		}
	}

	// 构建响应数据
	responseData := gin.H{
		"room_id":  room.Room_id,
		"seat_pos": seatPos,
	}

	// 只在Org_id不为nil时返回
	if room.Org_id != nil {
		responseData["org_id"] = *room.Org_id
	}

	// 如果bssid_list不为空也返回
	if room.Bssid_list != "" {
		responseData["bssid_list"] = room.Bssid_list
	}

	successResponse(c, responseData)
}

// --- Sign Session Logic ---

// CreateSignSession 教师端发起新的签到场次
func CreateSignSession(db *gorm.DB, c *gin.Context) {
	_, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}

	var req struct {
		CourseID uint   `json:"course_id"`
		RoomID   string `json:"room_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	// 检查是否有未结束的同课程/同房间 Session，如果有，先结束它
	var existingRoomSession SignSession
	if err := db.Where("room_id = ? AND is_active = ? AND course_id <> ?", req.RoomID, true, req.CourseID).Last(&existingRoomSession).Error; err == nil {
		var existingCourse Course
		_ = db.First(&existingCourse, existingRoomSession.CourseID).Error
		c.JSON(http.StatusConflict, Response{
			Code:    -1,
			Message: "该教室已有其他课程正在签到",
			Data: gin.H{
				"conflict": gin.H{
					"session": gin.H{
						"id":         existingRoomSession.ID,
						"course_id":  existingRoomSession.CourseID,
						"room_id":    existingRoomSession.RoomID,
						"start_time": existingRoomSession.StartTime,
					},
					"course": gin.H{
						"id":             existingCourse.ID,
						"name":           existingCourse.Name,
						"dayIndex":       existingCourse.DayIndex,
						"startSlotIndex": existingCourse.StartSlotIndex,
						"endSlotIndex":   existingCourse.EndSlotIndex,
						"location":       existingCourse.Location,
					},
				},
			},
		})
		return
	}

	db.Model(&SignSession{}).Where("course_id = ? AND is_active = ?", req.CourseID, true).Updates(map[string]interface{}{
		"is_active": false,
		"end_time":  time.Now(),
	})

	session := SignSession{
		CourseID:  req.CourseID,
		RoomID:    req.RoomID,
		StartTime: time.Now(),
		IsActive:  true,
	}

	if err := db.Create(&session).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "创建签到场次失败")
		return
	}

	successResponse(c, gin.H{"session": session})
}

// EndSignSession 处理相关逻辑
func EndSignSession(db *gorm.DB, c *gin.Context) {
	idStr := c.Param("id")
	if err := db.Model(&SignSession{}).Where("id = ?", idStr).Updates(map[string]interface{}{
		"is_active": false,
		"end_time":  time.Now(),
	}).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "结束签到场次失败")
		return
	}
	var session SignSession
	if err := db.First(&session, idStr).Error; err == nil {
		var course Course
		if err := db.First(&course, session.CourseID).Error; err == nil {
			generateAbsenceAlerts(db, session, course)
			generateAbsenceAlertsWithOpenID(db, session, course)
		}
	}
	successResponse(c, gin.H{"message": "已结束"})
}

// GetActiveSession 处理相关逻辑
func GetActiveSession(db *gorm.DB, c *gin.Context) {
	courseIDStr := c.Query("course_id")
	if courseIDStr == "" {
		errorResponse(c, http.StatusBadRequest, "Missing course_id")
		return
	}

	var session SignSession
	// 查找该课程当前活跃的 Session
	if err := db.Where("course_id = ? AND is_active = ?", courseIDStr, true).Last(&session).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			successResponse(c, gin.H{"session": nil})
		} else {
			errorResponse(c, http.StatusInternalServerError, "查询失败")
		}
		return
	}

	successResponse(c, gin.H{"session": session})
}

// GetSessionSignIns 处理相关逻辑
func GetSessionSignIns(db *gorm.DB, c *gin.Context) {
	sessionIDStr := c.Param("id")
	sessionID64, _ := strconv.ParseUint(strings.TrimSpace(sessionIDStr), 10, 64)
	sessionID := uint(sessionID64)

	if redisClient != nil && sessionID > 0 {
		key := cacheKeySessionSignIns(sessionID)
		if b, err := redisClient.Get(c.Request.Context(), key).Bytes(); err == nil && len(b) > 0 {
			var cached []SignIn
			if err := json.Unmarshal(b, &cached); err == nil {
				successResponse(c, gin.H{"sign_ins": cached})
				return
			}
		}
	}

	var signIns []SignIn
	if err := db.Where("session_id = ?", sessionIDStr).Find(&signIns).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询签到记录失败")
		return
	}

	if redisClient != nil && sessionID > 0 {
		key := cacheKeySessionSignIns(sessionID)
		if b, err := json.Marshal(signIns); err == nil {
			_ = redisClient.Set(c.Request.Context(), key, b, 2*time.Second).Err()
		}
	}
	successResponse(c, gin.H{"sign_ins": signIns})
}

// DeleteSignIn 删除签到记录
func DeleteSignIn(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	sessionIDStr := c.Param("sessionId")
	signInIDStr := c.Param("signId")

	sessionID64, _ := strconv.ParseUint(strings.TrimSpace(sessionIDStr), 10, 64)
	sessionID := uint(sessionID64)
	signInID64, _ := strconv.ParseUint(strings.TrimSpace(signInIDStr), 10, 64)
	signInID := uint(signInID64)

	if sessionID == 0 || signInID == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的参数")
		return
	}

	// 查找 Session → 获得 CourseID
	var session SignSession
	if err := db.First(&session, sessionID).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "签到场次不存在")
		return
	}

	// 查找 Course → 获得 UserID
	var course Course
	if err := db.First(&course, session.CourseID).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}

	// 权限校验：课程创建者 或 组织管理员
	isOwner := course.UserID == claims.UserID
	isAdmin := claims.Role == "org_owner"
	if !isOwner && !isAdmin {
		errorResponse(c, http.StatusForbidden, "无权限删除此签到记录")
		return
	}

	// 查找签到记录
	var signIn SignIn
	if err := db.Where("id = ? AND session_id = ?", signInID, sessionID).First(&signIn).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "签到记录不存在")
		return
	}

	// 删除签到记录
	if err := db.Delete(&signIn).Error; err != nil {
		log.Printf("删除签到记录失败: %v", err)
		errorResponse(c, http.StatusInternalServerError, "删除失败")
		return
	}

	// 级联删除关联的异常告警（同一场次、同一学生）
	db.Where("session_id = ? AND student_id = ?", sessionID, signIn.StudentID).Delete(&SignAnomalyAlert{})

	// 清理 Redis 缓存
	if redisClient != nil && sessionID > 0 {
		key := cacheKeySessionSignIns(sessionID)
		_ = redisClient.Del(c.Request.Context(), key).Err()
	}

	successResponse(c, gin.H{"message": "删除成功"})
}

// medianFloat64 计算浮点数切片的中位数，过滤 NaN 和 Inf
func medianFloat64(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	cp := make([]float64, 0, len(v))
	for _, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			continue
		}
		cp = append(cp, x)
	}
	if len(cp) == 0 {
		return 0
	}
	sort.Float64s(cp)
	m := len(cp) / 2
	if len(cp)%2 == 1 {
		return cp[m]
	}
	return (cp[m-1] + cp[m]) / 2
}

// madFloat64 计算绝对中位差 (Median Absolute Deviation)，用于鲁棒离群值检测
func madFloat64(v []float64, med float64) float64 {
	if len(v) == 0 {
		return 0
	}
	dev := make([]float64, 0, len(v))
	for _, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			continue
		}
		dev = append(dev, math.Abs(x-med))
	}
	return medianFloat64(dev)
}

type seatXY struct {
	X float64
	Y float64
}

// ifaceToFloat64 处理相关逻辑
func ifaceToFloat64(v interface{}) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case int32:
		return float64(t), true
	case uint:
		return float64(t), true
	case uint64:
		return float64(t), true
	case uint32:
		return float64(t), true
	case json.Number:
		if f, err := t.Float64(); err == nil {
			return f, true
		}
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return 0, false
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

// seatPosPointMap 处理相关逻辑
func seatPosPointMap(seatPosRaw string) map[string]seatXY {
	out := make(map[string]seatXY)
	seatPosRaw = strings.TrimSpace(seatPosRaw)
	if seatPosRaw == "" {
		return out
	}
	var obj interface{}
	if err := json.Unmarshal([]byte(seatPosRaw), &obj); err != nil {
		return out
	}
	var seats []interface{}
	switch t := obj.(type) {
	case map[string]interface{}:
		if s, ok := t["seats"].([]interface{}); ok {
			seats = s
		}
	case []interface{}:
		seats = t
	}
	for _, it := range seats {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		label := strings.TrimSpace(fmt.Sprintf("%v", m["seatNumber"]))
		if label == "" || label == "<nil>" {
			label = strings.TrimSpace(fmt.Sprintf("%v", m["label"]))
		}
		if label == "" || label == "<nil>" {
			continue
		}
		x, okx := ifaceToFloat64(m["x"])
		y, oky := ifaceToFloat64(m["y"])
		if !okx || !oky {
			continue
		}
		out[label] = seatXY{X: x, Y: y}
	}
	return out
}

// seatDist 处理相关逻辑
func seatDist(a, b seatXY) float64 {
	return math.Hypot(a.X-b.X, a.Y-b.Y)
}

// medianNearestNeighborDistance 处理相关逻辑
func medianNearestNeighborDistance(points []seatXY) float64 {
	if len(points) < 2 {
		return 0
	}
	nnd := make([]float64, 0, len(points))
	for i := range points {
		best := math.Inf(1)
		for j := range points {
			if i == j {
				continue
			}
			d := seatDist(points[i], points[j])
			if d <= 0 {
				continue
			}
			if d < best {
				best = d
			}
		}
		if !math.IsInf(best, 1) && !math.IsNaN(best) {
			nnd = append(nnd, best)
		}
	}
	return medianFloat64(nnd)
}

// dbscan2D 实现基于密度的空间聚类算法 (DBSCAN)，用于二维坐标的聚类，识别常用座位簇
func dbscan2D(points []seatXY, eps float64, minPts int) []int {
	labels := make([]int, len(points))
	if len(points) == 0 || eps <= 0 || minPts <= 0 {
		return labels
	}
	visited := make([]bool, len(points))
	clusterID := 0

	regionQuery := func(i int) []int {
		neighbors := make([]int, 0, 8)
		for j := range points {
			if seatDist(points[i], points[j]) <= eps {
				neighbors = append(neighbors, j)
			}
		}
		return neighbors
	}

	for i := range points {
		if visited[i] {
			continue
		}
		visited[i] = true
		neighbors := regionQuery(i)
		if len(neighbors) < minPts {
			labels[i] = -1
			continue
		}
		clusterID++
		labels[i] = clusterID
		queue := append([]int(nil), neighbors...)
		for qi := 0; qi < len(queue); qi++ {
			j := queue[qi]
			if !visited[j] {
				visited[j] = true
				neighbors2 := regionQuery(j)
				if len(neighbors2) >= minPts {
					queue = append(queue, neighbors2...)
				}
			}
			if labels[j] == 0 || labels[j] == -1 {
				labels[j] = clusterID
			}
		}
	}
	return labels
}

// kmeans2_1d 实现一维 K-Means 聚类 (k=2)，用于识别签到时间的主簇和离群簇
func kmeans2_1d(values []float64, iters int) (float64, float64, []int, bool) {
	if len(values) < 2 {
		return 0, 0, nil, false
	}
	minV := values[0]
	maxV := values[0]
	for _, v := range values[1:] {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	if minV == maxV {
		return 0, 0, nil, false
	}
	c0 := minV
	c1 := maxV
	assign := make([]int, len(values))
	for iter := 0; iter < iters; iter++ {
		var s0, s1 float64
		var n0, n1 int
		for i, v := range values {
			if math.Abs(v-c0) <= math.Abs(v-c1) {
				assign[i] = 0
				s0 += v
				n0++
			} else {
				assign[i] = 1
				s1 += v
				n1++
			}
		}
		if n0 == 0 || n1 == 0 {
			return 0, 0, nil, false
		}
		nc0 := s0 / float64(n0)
		nc1 := s1 / float64(n1)
		if math.Abs(nc0-c0) < 1e-3 && math.Abs(nc1-c1) < 1e-3 {
			c0 = nc0
			c1 = nc1
			break
		}
		c0 = nc0
		c1 = nc1
	}
	return c0, c1, assign, true
}

// meanStd 处理相关逻辑
func meanStd(values []float64) (float64, float64) {
	if len(values) == 0 {
		return 0, 0
	}
	var s float64
	for _, v := range values {
		s += v
	}
	m := s / float64(len(values))
	var ss float64
	for _, v := range values {
		d := v - m
		ss += d * d
	}
	std := math.Sqrt(ss / float64(len(values)))
	return m, std
}

// parseMembersJSON 处理相关逻辑
func parseMembersJSON(raw string) map[string]string {
	out := make(map[string]string)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return out
	}
	var arr []interface{}
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return out
	}
	for _, it := range arr {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		sid := strings.TrimSpace(fmt.Sprintf("%v", m["studentId"]))
		if sid == "" || sid == "<nil>" {
			sid = strings.TrimSpace(fmt.Sprintf("%v", m["student_id"]))
		}
		if sid == "" || sid == "<nil>" {
			continue
		}
		name := strings.TrimSpace(fmt.Sprintf("%v", m["name"]))
		if name == "<nil>" {
			name = ""
		}
		out[sid] = name
	}
	return out
}

// allowCourseAccess 处理相关逻辑
func allowCourseAccess(db *gorm.DB, claims AuthClaims, course Course) bool {
	if course.UserID == claims.UserID {
		return true
	}
	if claims.Role == "org_owner" && claims.OrgID != nil {
		var owner User
		if err := db.Select("id", "org_id").First(&owner, course.UserID).Error; err == nil {
			if owner.OrgID != nil && *owner.OrgID == *claims.OrgID {
				return true
			}
		}
	}
	return false
}

// GetSessionAlerts 处理相关逻辑
func GetSessionAlerts(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := strings.TrimSpace(c.Param("id"))
	id64, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的场次ID")
		return
	}

	var session SignSession
	if err := db.First(&session, uint(id64)).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "签到场次不存在")
		return
	}

	var course Course
	if err := db.First(&course, session.CourseID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "课程不存在")
		return
	}
	if !allowCourseAccess(db, claims, course) {
		errorResponse(c, http.StatusForbidden, "无权限查看该场次")
		return
	}

	var alerts []SignAnomalyAlert
	if err := db.Where("session_id = ?", session.ID).Order("created_at asc").Find(&alerts).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}
	successResponse(c, gin.H{"alerts": alerts})
}

// GetAbsenceAlertsByOpenID 根据openid获取缺勤提醒
func GetAbsenceAlertsByOpenID(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("wxClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	wxClaims := v.(WxClaims)
	openid := wxClaims.OpenID
	if openid == "" {
		errorResponse(c, http.StatusBadRequest, "无效的openid")
		return
	}

	// 查询该openid的未读缺勤提醒
	var alerts []SignAbsenceAlert
	if err := db.Where("open_id = ? AND status = ?", openid, "pending").Order("created_at DESC").Find(&alerts).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	// 将提醒标记为已读
	db.Model(&SignAbsenceAlert{}).Where("open_id = ? AND status = ?", openid, "pending").Update("status", "read")

	successResponse(c, gin.H{"alerts": alerts})
}

// RemindAbsence 一键提醒缺勤
func RemindAbsence(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	idStr := c.Param("id")
	sessionID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的场次ID")
		return
	}

	// 查询场次信息
	var session SignSession
	if err := db.First(&session, uint(sessionID)).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "场次不存在")
		return
	}

	// 查询课程信息
	var course Course
	if err := db.First(&course, session.CourseID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "课程不存在")
		return
	}

	// 检查权限
	if !allowCourseAccess(db, claims, course) {
		errorResponse(c, http.StatusForbidden, "无权限操作该课程")
		return
	}

	// 生成缺勤提醒
	generateAbsenceAlertsWithOpenID(db, session, course)

	successResponse(c, gin.H{"message": "提醒已发送"})
}

// GetSessionLeaves 处理相关逻辑
func GetSessionLeaves(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := strings.TrimSpace(c.Param("id"))
	id64, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的场次ID")
		return
	}

	var session SignSession
	if err := db.First(&session, uint(id64)).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "签到场次不存在")
		return
	}

	var course Course
	if err := db.First(&course, session.CourseID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "课程不存在")
		return
	}
	if strings.TrimSpace(course.MemberMode) == "all" {
		errorResponse(c, http.StatusBadRequest, "开放模式不支持请假登记")
		return
	}

	if !allowCourseAccess(db, claims, course) {
		errorResponse(c, http.StatusForbidden, "无权限查看该场次")
		return
	}

	var leaves []SignLeave
	if err := db.Where("session_id = ?", session.ID).Find(&leaves).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	out := make([]gin.H, 0, len(leaves))
	for _, r := range leaves {
		out = append(out, gin.H{
			"student_id": r.StudentID,
			"reason":     r.Reason,
		})
	}
	successResponse(c, gin.H{"leaves": out})
}

// PutSessionLeaves 处理相关逻辑
func PutSessionLeaves(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := strings.TrimSpace(c.Param("id"))
	id64, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的场次ID")
		return
	}

	var session SignSession
	if err := db.First(&session, uint(id64)).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "签到场次不存在")
		return
	}

	var course Course
	if err := db.First(&course, session.CourseID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "课程不存在")
		return
	}
	if strings.TrimSpace(course.MemberMode) == "all" {
		errorResponse(c, http.StatusBadRequest, "开放模式不支持请假登记")
		return
	}

	if !allowCourseAccess(db, claims, course) {
		errorResponse(c, http.StatusForbidden, "无权限修改该场次")
		return
	}

	var req struct {
		Leaves []struct {
			StudentID string `json:"student_id"`
			Reason    string `json:"reason"`
		} `json:"leaves"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	seen := make(map[string]bool)
	rows := make([]SignLeave, 0, len(req.Leaves))
	for _, l := range req.Leaves {
		sid := strings.TrimSpace(l.StudentID)
		reason := strings.TrimSpace(l.Reason)
		if sid == "" {
			continue
		}
		if seen[sid] {
			errorResponse(c, http.StatusBadRequest, "请假名单存在重复学号")
			return
		}
		seen[sid] = true
		if len(reason) > 255 {
			reason = reason[:255]
		}
		rows = append(rows, SignLeave{
			SessionID: session.ID,
			StudentID: sid,
			Reason:    reason,
		})
	}

	if len(rows) > 0 {
		sids := make([]string, 0, len(rows))
		for _, r := range rows {
			if strings.TrimSpace(r.StudentID) == "" {
				continue
			}
			sids = append(sids, r.StudentID)
		}
		if len(sids) > 0 {
			type signedRow struct {
				StudentID string `gorm:"column:student_id"`
			}
			var signed []signedRow
			if err := db.Model(&SignIn{}).
				Select("student_id").
				Where("session_id = ? AND status = ? AND student_id IN ?", session.ID, "success", sids).
				Scan(&signed).Error; err == nil && len(signed) > 0 {
				errorResponse(c, http.StatusBadRequest, fmt.Sprintf("学号 %s 已签到，无法登记请假", signed[0].StudentID))
				return
			}
		}
	}

	tx := db.Begin()
	if err := tx.Where("session_id = ?", session.ID).Delete(&SignLeave{}).Error; err != nil {
		tx.Rollback()
		errorResponse(c, http.StatusInternalServerError, "保存失败")
		return
	}
	if len(rows) > 0 {
		if err := tx.CreateInBatches(rows, 200).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "保存失败")
			return
		}
	}
	if err := tx.Commit().Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "保存失败")
		return
	}

	successResponse(c, gin.H{"message": "保存成功"})
}

// createSessionAlert 处理相关逻辑
func createSessionAlert(db *gorm.DB, sessionID uint, studentID string, kind string, score float64, message string, seatLabel string) {
	studentID = strings.TrimSpace(studentID)
	kind = strings.TrimSpace(kind)
	if sessionID == 0 || studentID == "" || kind == "" {
		return
	}
	var exists int64
	db.Model(&SignAnomalyAlert{}).Where("session_id = ? AND student_id = ? AND kind = ?", sessionID, studentID, kind).Count(&exists)
	if exists > 0 {
		return
	}
	_ = db.Create(&SignAnomalyAlert{
		SessionID: sessionID,
		StudentID: studentID,
		Kind:      kind,
		Score:     score,
		Message:   strings.TrimSpace(message),
		SeatLabel: strings.TrimSpace(seatLabel),
	}).Error
}

func ruleWarnText(reason string) string {
	switch strings.TrimSpace(reason) {
	case "auth_invalid":
		return "微信登录已失效/未登录"
	case "wifi_missing":
		return "未连接指定WiFi"
	case "wifi_not_whitelisted":
		return "WiFi不在白名单"
	case "gps_missing":
		return "未获取定位"
	case "gps_out_of_range":
		return "定位不在允许范围内"
	case "ip_not_whitelisted":
		return "出口IP不在允许范围内"
	default:
		return strings.TrimSpace(reason)
	}
}

// generateSignInAnomalies 基于时间 K-Means 和座位 DBSCAN 聚类算法生成签到异常预警
func generateSignInAnomalies(db *gorm.DB, session SignSession, course Course, studentID string, studentName string, seatLabel string, signTime time.Time) {
	studentID = strings.TrimSpace(studentID)
	if session.ID == 0 || course.ID == 0 || studentID == "" {
		return
	}

	type histRow struct {
		SignTime  time.Time `gorm:"column:sign_time"`
		StartTime time.Time `gorm:"column:start_time"`
		SeatLabel string    `gorm:"column:seat_label"`
	}
	var hist []histRow
	db.Table("sign_ins as si").
		Select("si.time as sign_time, ss.start_time as start_time, si.seat_label as seat_label").
		Joins("JOIN sign_sessions ss ON ss.id = si.session_id").
		Where("ss.course_id = ? AND si.student_id = ? AND si.session_id <> ? AND si.status = ?", course.ID, studentID, session.ID, "success").
		Order("si.time desc").
		Limit(30).
		Scan(&hist)

	deltas := make([]float64, 0, len(hist))
	seatCounts := make(map[string]int, 8)
	for _, h := range hist {
		if !h.StartTime.IsZero() && !h.SignTime.IsZero() {
			deltas = append(deltas, h.SignTime.Sub(h.StartTime).Minutes())
		}
		sl := strings.TrimSpace(h.SeatLabel)
		if sl != "" {
			seatCounts[sl]++
		}
	}

	if !session.StartTime.IsZero() && !signTime.IsZero() && len(deltas) >= 6 {
		delta := signTime.Sub(session.StartTime).Minutes()
		bestScore := 0.0
		bestMsg := ""

		med := medianFloat64(deltas)
		mad := madFloat64(deltas, med)
		robustScore := 0.0
		if mad > 0 {
			robustScore = math.Abs(delta-med) / mad
		} else {
			robustScore = math.Abs(delta - med)
		}
		if (mad > 0 && robustScore >= 6) || (mad == 0 && robustScore >= 20) {
			bestScore = robustScore
			bestMsg = fmt.Sprintf("签到时间异常（鲁棒）：%.0f分钟（历史中位数 %.0f）", delta, med)
		}

		if len(deltas) >= 10 {
			c0, c1, assign, ok := kmeans2_1d(deltas, 12)
			if ok {
				cnt0 := 0
				cnt1 := 0
				val0 := make([]float64, 0, len(deltas))
				val1 := make([]float64, 0, len(deltas))
				for i, a := range assign {
					if a == 0 {
						cnt0++
						val0 = append(val0, deltas[i])
					} else {
						cnt1++
						val1 = append(val1, deltas[i])
					}
				}
				dom := 0
				domCnt := cnt0
				domMean := c0
				domVals := val0
				if cnt1 > cnt0 {
					dom = 1
					domCnt = cnt1
					domMean = c1
					domVals = val1
				}
				ratio := float64(domCnt) / float64(len(deltas))
				if domCnt >= 6 && ratio >= 0.75 {
					curCluster := 0
					if math.Abs(delta-c0) > math.Abs(delta-c1) {
						curCluster = 1
					}
					if curCluster != dom {
						_, std := meanStd(domVals)
						z := 0.0
						if std > 0 {
							z = math.Abs(delta-domMean) / std
						} else {
							z = math.Abs(delta - domMean)
						}
						if (std > 0 && z >= 3) || (std == 0 && z >= 20) {
							msg := fmt.Sprintf("签到时间异常（聚类）：%.0f分钟（常规簇均值 %.0f）", delta, domMean)
							if z > bestScore {
								bestScore = z
								bestMsg = msg
							}
						}
					}
				}
			}
		}

		if bestMsg != "" {
			createSessionAlert(db, session.ID, studentID, "time_outlier", bestScore, bestMsg, seatLabel)
		}
	}

	if !course.FixedSeatEnabled && len(seatCounts) >= 1 && strings.TrimSpace(seatLabel) != "" {
		bestScore := 0.0
		bestMsg := ""

		var owner User
		ownerOrgID := (*uint)(nil)
		if err := db.Select("id", "org_id").First(&owner, course.UserID).Error; err == nil {
			ownerOrgID = owner.OrgID
		}
		var room Room
		roomFound := false
		if strings.TrimSpace(session.RoomID) != "" {
			if ownerOrgID != nil {
				if err := db.Where("room_id = ? AND org_id = ?", session.RoomID, int(*ownerOrgID)).First(&room).Error; err == nil {
					roomFound = true
				}
			} else {
				if err := db.Where("room_id = ?", session.RoomID).First(&room).Error; err == nil {
					roomFound = true
				}
			}
		}

		if roomFound && strings.TrimSpace(room.Seat_pos) != "" {
			posMap := seatPosPointMap(room.Seat_pos)
			cur, okCur := posMap[strings.TrimSpace(seatLabel)]
			if okCur {
				histPts := make([]seatXY, 0, len(hist))
				for _, h := range hist {
					sl := strings.TrimSpace(h.SeatLabel)
					if sl == "" {
						continue
					}
					if p, ok := posMap[sl]; ok {
						histPts = append(histPts, p)
					}
				}
				if len(histPts) >= 8 {
					base := medianNearestNeighborDistance(histPts)
					eps := base * 2.5
					if eps < 1 {
						eps = 1
					}
					if eps > 800 {
						eps = 800
					}
					labels := dbscan2D(histPts, eps, 3)
					size := make(map[int]int)
					for _, lab := range labels {
						if lab > 0 {
							size[lab]++
						}
					}
					domID := 0
					domCnt := 0
					for id, c := range size {
						if c > domCnt {
							domCnt = c
							domID = id
						}
					}
					if domID > 0 {
						ratio := float64(domCnt) / float64(len(histPts))
						if domCnt >= 3 && ratio >= 0.7 {
							best := math.Inf(1)
							for i, lab := range labels {
								if lab != domID {
									continue
								}
								d := seatDist(cur, histPts[i])
								if d < best {
									best = d
								}
							}
							if !math.IsInf(best, 1) && best > eps {
								score := best / eps
								msg := fmt.Sprintf("座位选择异常（聚类）：本次 %s（偏离常规簇）", strings.TrimSpace(seatLabel))
								bestScore = score
								bestMsg = msg
							}
						}
					}
				}
			}
		}

		if bestMsg == "" {
			total := 0
			topSeat := ""
			topCnt := 0
			for s, c := range seatCounts {
				total += c
				if c > topCnt {
					topCnt = c
					topSeat = s
				}
			}
			if total >= 3 && topCnt >= 3 && topSeat != "" && topSeat != seatLabel {
				ratio := float64(topCnt) / float64(total)
				if ratio >= 0.7 {
					bestScore = ratio
					bestMsg = fmt.Sprintf("座位选择异常：本次 %s（历史常用 %s）", seatLabel, topSeat)
				}
			}
		}

		if bestMsg != "" {
			createSessionAlert(db, session.ID, studentID, "seat_outlier", bestScore, bestMsg, seatLabel)
		}
	}

	if strings.TrimSpace(studentName) != "" && strings.TrimSpace(studentID) != "" {
		_ = studentName
	}
}

// generateAbsenceAlerts 处理相关逻辑
func generateAbsenceAlerts(db *gorm.DB, session SignSession, course Course) {
	if session.ID == 0 || course.ID == 0 {
		return
	}
	mode := strings.TrimSpace(course.MemberMode)
	if mode == "all" {
		return
	}

	expected := make(map[string]string)
	if mode == "independent" {
		for sid, name := range parseMembersJSON(course.Members) {
			expected[sid] = name
		}
	} else if mode == "class" && strings.TrimSpace(course.ClassRosterID) != "" {
		if rid, err := strconv.ParseUint(strings.TrimSpace(course.ClassRosterID), 10, 64); err == nil && rid > 0 {
			var owner User
			if err := db.Select("id", "org_id").First(&owner, course.UserID).Error; err == nil && owner.OrgID != nil {
				var roster ClassRoster
				if err := db.Where("id = ? AND org_id = ?", uint(rid), *owner.OrgID).First(&roster).Error; err == nil {
					for sid, name := range parseMembersJSON(roster.Members) {
						expected[sid] = name
					}
				}
			}
		}
	}
	if len(expected) == 0 {
		return
	}

	var signIns []SignIn
	db.Where("session_id = ?", session.ID).Find(&signIns)
	signed := make(map[string]bool, len(signIns))
	for _, si := range signIns {
		sid := strings.TrimSpace(si.StudentID)
		if sid != "" {
			signed[sid] = true
		}
	}

	var leaves []SignLeave
	db.Where("session_id = ?", session.ID).Find(&leaves)
	onLeave := make(map[string]bool, len(leaves))
	for _, l := range leaves {
		sid := strings.TrimSpace(l.StudentID)
		if sid != "" {
			onLeave[sid] = true
		}
	}

	for sid, name := range expected {
		if sid == "" {
			continue
		}
		if signed[sid] || onLeave[sid] {
			continue
		}
		msg := "缺勤"
		if strings.TrimSpace(name) != "" {
			msg = fmt.Sprintf("缺勤：%s", name)
		}
		createSessionAlert(db, session.ID, sid, "absent", 1, msg, "")
	}
}

// generateAbsenceAlertsWithOpenID 生成缺勤提醒并关联openid
func generateAbsenceAlertsWithOpenID(db *gorm.DB, session SignSession, course Course) {
	if session.ID == 0 || course.ID == 0 {
		return
	}
	mode := strings.TrimSpace(course.MemberMode)
	if mode == "all" {
		return
	}

	expected := make(map[string]string)
	if mode == "independent" {
		for sid, name := range parseMembersJSON(course.Members) {
			expected[sid] = name
		}
	} else if mode == "class" && strings.TrimSpace(course.ClassRosterID) != "" {
		if rid, err := strconv.ParseUint(strings.TrimSpace(course.ClassRosterID), 10, 64); err == nil && rid > 0 {
			var owner User
			if err := db.Select("id", "org_id").First(&owner, course.UserID).Error; err == nil && owner.OrgID != nil {
				var roster ClassRoster
				if err := db.Where("id = ? AND org_id = ?", uint(rid), *owner.OrgID).First(&roster).Error; err == nil {
					for sid, name := range parseMembersJSON(roster.Members) {
						expected[sid] = name
					}
				}
			}
		}
	}
	if len(expected) == 0 {
		return
	}

	var signIns []SignIn
	db.Where("session_id = ?", session.ID).Find(&signIns)
	signed := make(map[string]bool, len(signIns))
	for _, si := range signIns {
		sid := strings.TrimSpace(si.StudentID)
		if sid != "" {
			signed[sid] = true
		}
	}

	var leaves []SignLeave
	db.Where("session_id = ?", session.ID).Find(&leaves)
	onLeave := make(map[string]bool, len(leaves))
	for _, l := range leaves {
		sid := strings.TrimSpace(l.StudentID)
		if sid != "" {
			onLeave[sid] = true
		}
	}

	for sid := range expected {
		if sid == "" {
			continue
		}
		if signed[sid] || onLeave[sid] {
			continue
		}

		// 查找学生的openid（从之前的签到记录中）
		var lastSignIn SignIn
		db.Where("student_id = ? AND open_id IS NOT NULL", sid).Order("time DESC").First(&lastSignIn)

		openid := ""
		if lastSignIn.OpenID != nil {
			openid = *lastSignIn.OpenID
		}
		openid = strings.TrimSpace(openid)
		if openid == "" {
			continue
		}

		// 创建缺勤提醒
		var existing SignAbsenceAlert
		if err := db.Where("session_id = ? AND student_id = ?", session.ID, sid).First(&existing).Error; err == nil {
			_ = db.Model(&SignAbsenceAlert{}).Where("id = ?", existing.ID).Updates(map[string]interface{}{
				"open_id":     openid,
				"course_id":   course.ID,
				"course_name": course.Name,
				"status":      "pending",
				"updated_at":  time.Now(),
			}).Error
		} else {
			alert := SignAbsenceAlert{
				SessionID:  session.ID,
				CourseID:   course.ID,
				StudentID:  sid,
				OpenID:     openid,
				CourseName: course.Name,
				Status:     "pending",
			}
			_ = db.Create(&alert).Error
		}
	}
}

// ListSignSessions 处理相关逻辑
func ListSignSessions(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	courseIDStr := strings.TrimSpace(c.Query("course_id"))
	if courseIDStr == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要参数: course_id")
		return
	}
	courseID64, err := strconv.ParseUint(courseIDStr, 10, 64)
	if err != nil || courseID64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的 course_id")
		return
	}
	courseID := uint(courseID64)

	var course Course
	if err := db.First(&course, courseID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			errorResponse(c, http.StatusNotFound, "课程不存在")
		} else {
			errorResponse(c, http.StatusInternalServerError, "查询课程失败")
		}
		return
	}
	if course.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限查看该课程的签到场次")
		return
	}

	limit := 50
	if limitStr := strings.TrimSpace(c.Query("limit")); limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil {
			if n > 0 && n <= 200 {
				limit = n
			}
		}
	}

	q := db.Model(&SignSession{}).Where("course_id = ?", courseID)
	if roomID := strings.TrimSpace(c.Query("room_id")); roomID != "" {
		q = q.Where("room_id = ?", filepath.Base(roomID))
	}

	var sessions []SignSession
	if err := q.Order("start_time desc").Limit(limit).Find(&sessions).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询签到场次失败")
		return
	}

	ids := make([]uint, 0, len(sessions))
	for _, s := range sessions {
		ids = append(ids, s.ID)
	}

	countMap := make(map[uint]int64, len(ids))
	if len(ids) > 0 {
		var rows []struct {
			SessionID uint  `gorm:"column:session_id"`
			Cnt       int64 `gorm:"column:cnt"`
		}
		db.Model(&SignIn{}).
			Select("session_id, COUNT(*) as cnt").
			Where("session_id IN ?", ids).
			Group("session_id").
			Scan(&rows)
		for _, r := range rows {
			countMap[r.SessionID] = r.Cnt
		}
	}

	result := make([]gin.H, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, gin.H{
			"id":            s.ID,
			"course_id":     s.CourseID,
			"room_id":       s.RoomID,
			"start_time":    s.StartTime,
			"end_time":      s.EndTime,
			"is_active":     s.IsActive,
			"sign_in_count": countMap[s.ID],
		})
	}

	successResponse(c, gin.H{"sessions": result})
}

// parseQueryTime 处理相关逻辑
func parseQueryTime(s string, endOfDay bool) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	if strings.Contains(s, "T") {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t, true
		}
	}
	if t, err := time.ParseInLocation("2006-01-02", s, time.Local); err == nil {
		if endOfDay {
			return t.Add(24*time.Hour - time.Nanosecond), true
		}
		return t, true
	}
	return time.Time{}, false
}

// AttendanceListCourses 处理相关逻辑
func AttendanceListCourses(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.Role != "org_owner" || claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	type row struct {
		ID       uint   `gorm:"column:id"`
		Name     string `gorm:"column:name"`
		Location string `gorm:"column:location"`
		UserID   uint   `gorm:"column:user_id"`
		Username string `gorm:"column:username"`
	}

	var rows []row
	if err := db.Table("courses as c").
		Select("c.id, c.name, c.location, c.user_id, u.username").
		Joins("JOIN users u ON u.id = c.user_id").
		Where("u.org_id = ?", *claims.OrgID).
		Order("c.id desc").
		Scan(&rows).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"id":       r.ID,
			"name":     r.Name,
			"location": r.Location,
			"user_id":  r.UserID,
			"username": r.Username,
		})
	}
	successResponse(c, gin.H{"courses": out})
}

// AttendanceListSessions 处理相关逻辑
func AttendanceListSessions(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	var visibleUserIDs []uint
	if claims.Role == "org_owner" && claims.OrgID != nil {
		db.Model(&User{}).Where("org_id = ?", *claims.OrgID).Pluck("id", &visibleUserIDs)
	} else {
		visibleUserIDs = []uint{claims.UserID}
	}
	if len(visibleUserIDs) == 0 {
		successResponse(c, gin.H{"sessions": []interface{}{}})
		return
	}

	courseIDStr := strings.TrimSpace(c.Query("course_id"))
	rosterIDStr := strings.TrimSpace(c.Query("roster_id"))
	fromStr := strings.TrimSpace(c.Query("from"))
	toStr := strings.TrimSpace(c.Query("to"))

	limit := 100
	if limitStr := strings.TrimSpace(c.Query("limit")); limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil {
			if n > 0 && n <= 500 {
				limit = n
			}
		}
	}
	offset := 0
	if offsetStr := strings.TrimSpace(c.Query("offset")); offsetStr != "" {
		if n, err := strconv.Atoi(offsetStr); err == nil && n >= 0 {
			offset = n
		}
	}

	q := db.Table("sign_sessions as ss").
		Select("ss.id, ss.course_id, ss.room_id, ss.start_time, ss.end_time, ss.is_active, c.name as course_name, c.class_roster_id, c.member_mode, u.username").
		Joins("JOIN courses c ON c.id = ss.course_id").
		Joins("JOIN users u ON u.id = c.user_id").
		Where("c.user_id IN ?", visibleUserIDs)

	if courseIDStr != "" {
		if v, err := strconv.ParseUint(courseIDStr, 10, 64); err == nil && v > 0 {
			q = q.Where("ss.course_id = ?", uint(v))
		} else {
			errorResponse(c, http.StatusBadRequest, "无效的 course_id")
			return
		}
	}
	if rosterIDStr != "" {
		q = q.Where("c.class_roster_id = ?", rosterIDStr)
	}
	if t, ok := parseQueryTime(fromStr, false); ok {
		q = q.Where("ss.start_time >= ?", t)
	}
	if t, ok := parseQueryTime(toStr, true); ok {
		q = q.Where("ss.start_time <= ?", t)
	}

	type row struct {
		ID            uint      `gorm:"column:id"`
		CourseID      uint      `gorm:"column:course_id"`
		RoomID        string    `gorm:"column:room_id"`
		StartTime     time.Time `gorm:"column:start_time"`
		EndTime       time.Time `gorm:"column:end_time"`
		IsActive      bool      `gorm:"column:is_active"`
		CourseName    string    `gorm:"column:course_name"`
		ClassRosterID string    `gorm:"column:class_roster_id"`
		MemberMode    string    `gorm:"column:member_mode"`
		Username      string    `gorm:"column:username"`
	}

	var rows []row
	if err := q.Order("ss.start_time desc").Limit(limit + 1).Offset(offset).Scan(&rows).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	hasMore := false
	if len(rows) > limit {
		hasMore = true
		rows = rows[:limit]
	}

	ids := make([]uint, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	countMap := make(map[uint]int64, len(ids))
	if len(ids) > 0 {
		var cntRows []struct {
			SessionID uint  `gorm:"column:session_id"`
			Cnt       int64 `gorm:"column:cnt"`
		}
		db.Model(&SignIn{}).
			Select("session_id, COUNT(*) as cnt").
			Where("session_id IN ?", ids).
			Group("session_id").
			Scan(&cntRows)
		for _, r := range cntRows {
			countMap[r.SessionID] = r.Cnt
		}
	}

	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"id":               r.ID,
			"course_id":        r.CourseID,
			"course_name":      r.CourseName,
			"teacher_username": r.Username,
			"room_id":          r.RoomID,
			"start_time":       r.StartTime,
			"end_time":         r.EndTime,
			"is_active":        r.IsActive,
			"sign_in_count":    countMap[r.ID],
			"member_mode":      r.MemberMode,
			"class_roster_id":  r.ClassRosterID,
		})
	}
	successResponse(c, gin.H{"sessions": out, "has_more": hasMore})
}

// AttendanceExportSessions 处理相关逻辑
func AttendanceExportSessions(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	var visibleUserIDs []uint
	if claims.Role == "org_owner" && claims.OrgID != nil {
		db.Model(&User{}).Where("org_id = ?", *claims.OrgID).Pluck("id", &visibleUserIDs)
	} else {
		visibleUserIDs = []uint{claims.UserID}
	}
	if len(visibleUserIDs) == 0 {
		errorResponse(c, http.StatusBadRequest, "无可导出数据")
		return
	}

	courseIDStr := strings.TrimSpace(c.Query("course_id"))
	rosterIDStr := strings.TrimSpace(c.Query("roster_id"))
	fromStr := strings.TrimSpace(c.Query("from"))
	toStr := strings.TrimSpace(c.Query("to"))

	q := db.Table("sign_sessions as ss").
		Select("ss.id, ss.course_id, ss.room_id, ss.start_time, ss.end_time, ss.is_active, c.name as course_name, c.class_roster_id, c.member_mode, c.members, u.username").
		Joins("JOIN courses c ON c.id = ss.course_id").
		Joins("JOIN users u ON u.id = c.user_id").
		Where("c.user_id IN ?", visibleUserIDs).
		Where("ss.is_active = ?", false)

	if courseIDStr != "" {
		if v, err := strconv.ParseUint(courseIDStr, 10, 64); err == nil && v > 0 {
			q = q.Where("ss.course_id = ?", uint(v))
		} else {
			errorResponse(c, http.StatusBadRequest, "无效的 course_id")
			return
		}
	}
	if rosterIDStr != "" {
		q = q.Where("c.class_roster_id = ?", rosterIDStr)
	}
	if t, ok := parseQueryTime(fromStr, false); ok {
		q = q.Where("ss.start_time >= ?", t)
	}
	if t, ok := parseQueryTime(toStr, true); ok {
		q = q.Where("ss.start_time <= ?", t)
	}

	type row struct {
		ID            uint      `gorm:"column:id"`
		CourseID      uint      `gorm:"column:course_id"`
		RoomID        string    `gorm:"column:room_id"`
		StartTime     time.Time `gorm:"column:start_time"`
		EndTime       time.Time `gorm:"column:end_time"`
		IsActive      bool      `gorm:"column:is_active"`
		CourseName    string    `gorm:"column:course_name"`
		ClassRosterID string    `gorm:"column:class_roster_id"`
		MemberMode    string    `gorm:"column:member_mode"`
		Members       string    `gorm:"column:members"`
		Username      string    `gorm:"column:username"`
	}

	var rows []row
	if err := q.Order("ss.start_time desc").Limit(200).Scan(&rows).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	f := excelize.NewFile()
	defaultSheet := f.GetSheetName(0)
	wroteAny := false

	parseMembers := func(raw string) map[string]string {
		out := make(map[string]string)
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return out
		}
		var arr []interface{}
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			return out
		}
		for _, it := range arr {
			switch v := it.(type) {
			case map[string]interface{}:
				sid := strings.TrimSpace(fmt.Sprintf("%v", v["studentId"]))
				if sid == "" || sid == "<nil>" {
					sid = strings.TrimSpace(fmt.Sprintf("%v", v["student_id"]))
				}
				if sid == "" || sid == "<nil>" {
					continue
				}
				name := strings.TrimSpace(fmt.Sprintf("%v", v["name"]))
				if name == "<nil>" {
					name = ""
				}
				out[sid] = name
			}
		}
		return out
	}

	buildWarnText := func(warnReasons string) string {
		parts := strings.Split(warnReasons, ",")
		out := make([]string, 0, len(parts))
		seen := make(map[string]bool, len(parts))
		for _, p := range parts {
			k := strings.TrimSpace(p)
			if k == "" || seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, ruleWarnText(k))
		}
		return strings.Join(out, "；")
	}

	signStatusText := func(si SignIn) (string, string) {
		warnText := buildWarnText(si.WarnReasons)
		status := "已签到"
		if strings.TrimSpace(si.Status) == "late" {
			status = "迟到"
		}
		if strings.TrimSpace(si.SignQuality) == "warn" {
			if status == "迟到" {
				status = "迟到(异常)"
			} else {
				status = "异常签到"
			}
		}
		return status, warnText
	}

	for idx, r := range rows {
		var signIns []SignIn
		if err := db.Where("session_id = ?", r.ID).Find(&signIns).Error; err != nil {
			continue
		}

		leaveReason := make(map[string]string)
		{
			var leaves []SignLeave
			_ = db.Where("session_id = ?", r.ID).Find(&leaves).Error
			for _, lv := range leaves {
				sid := strings.TrimSpace(lv.StudentID)
				if sid == "" {
					continue
				}
				leaveReason[sid] = strings.TrimSpace(lv.Reason)
			}
		}

		expected := make(map[string]string)
		if r.MemberMode == "independent" {
			for sid, name := range parseMembers(r.Members) {
				expected[sid] = name
			}
		} else if r.MemberMode == "class" && strings.TrimSpace(r.ClassRosterID) != "" {
			if rid, err := strconv.ParseUint(strings.TrimSpace(r.ClassRosterID), 10, 64); err == nil && rid > 0 {
				var roster ClassRoster
				if err := db.First(&roster, uint(rid)).Error; err == nil {
					for sid, name := range parseMembers(roster.Members) {
						expected[sid] = name
					}
				}
			}
		}

		signed := make(map[string]SignIn)
		for _, si := range signIns {
			sid := strings.TrimSpace(si.StudentID)
			if sid == "" {
				continue
			}
			signed[sid] = si
		}

		sheetName := fmt.Sprintf("S%d", r.ID)
		if !wroteAny {
			f.SetSheetName(defaultSheet, sheetName)
			wroteAny = true
		} else {
			f.NewSheet(sheetName)
		}

		headers := []string{"学号", "姓名", "座位", "签到时间", "状态", "异常原因", "请假原因"}
		for i, h := range headers {
			cell, _ := excelize.CoordinatesToCellName(i+1, 1)
			f.SetCellValue(sheetName, cell, h)
		}

		rowNum := 2
		seenSigned := make(map[string]bool)
		if len(expected) > 0 {
			ids := make([]string, 0, len(expected))
			for sid := range expected {
				ids = append(ids, sid)
			}
			sort.Strings(ids)
			for _, sid := range ids {
				name := expected[sid]
				if si, ok := signed[sid]; ok {
					seenSigned[sid] = true
					stText, warnText := signStatusText(si)
					values := []interface{}{sid, func() string {
						if strings.TrimSpace(si.StudentName) != "" {
							return si.StudentName
						}
						return name
					}(), si.SeatLabel, si.Time.Format("2006-01-02 15:04:05"), stText, warnText, ""}
					for col, v := range values {
						cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
						f.SetCellValue(sheetName, cell, v)
					}
				} else {
					if lr, ok := leaveReason[sid]; ok {
						values := []interface{}{sid, name, "", "", "请假", "", lr}
						for col, v := range values {
							cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
							f.SetCellValue(sheetName, cell, v)
						}
					} else {
						values := []interface{}{sid, name, "", "", "缺勤", "", ""}
						for col, v := range values {
							cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
							f.SetCellValue(sheetName, cell, v)
						}
					}
				}
				rowNum++
			}

			for _, si := range signIns {
				sid := strings.TrimSpace(si.StudentID)
				if sid == "" || seenSigned[sid] {
					continue
				}
				stText, warnText := signStatusText(si)
				if stText == "迟到" {
					stText = "迟到(非名单)"
				} else if stText == "迟到(异常)" {
					stText = "迟到(异常)(非名单)"
				} else if stText == "异常签到" {
					stText = "异常签到(非名单)"
				} else {
					stText = "已签到(非名单)"
				}
				values := []interface{}{sid, si.StudentName, si.SeatLabel, si.Time.Format("2006-01-02 15:04:05"), stText, warnText, ""}
				for col, v := range values {
					cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
					f.SetCellValue(sheetName, cell, v)
				}
				rowNum++
			}
		} else {
			for _, si := range signIns {
				stText, warnText := signStatusText(si)
				values := []interface{}{si.StudentID, si.StudentName, si.SeatLabel, si.Time.Format("2006-01-02 15:04:05"), stText, warnText, ""}
				for col, v := range values {
					cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
					f.SetCellValue(sheetName, cell, v)
				}
				rowNum++
			}
		}

		if idx == 0 {
			f.SetActiveSheet(0)
		}
	}

	if !wroteAny {
		errorResponse(c, http.StatusBadRequest, "无可导出数据")
		return
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "导出失败")
		return
	}

	filename := fmt.Sprintf("attendance_detail_%s.xlsx", time.Now().Format("20060102_150405"))
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf.Bytes())
}

// AttendanceExportSession 处理相关逻辑
func AttendanceExportSession(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := strings.TrimSpace(c.Param("id"))
	id64, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的场次ID")
		return
	}
	sessionID := uint(id64)

	type row struct {
		ID            uint      `gorm:"column:id"`
		CourseID      uint      `gorm:"column:course_id"`
		RoomID        string    `gorm:"column:room_id"`
		StartTime     time.Time `gorm:"column:start_time"`
		EndTime       time.Time `gorm:"column:end_time"`
		IsActive      bool      `gorm:"column:is_active"`
		CourseName    string    `gorm:"column:course_name"`
		ClassRosterID string    `gorm:"column:class_roster_id"`
		MemberMode    string    `gorm:"column:member_mode"`
		Members       string    `gorm:"column:members"`
		UserID        uint      `gorm:"column:user_id"`
		OrgID         *uint     `gorm:"column:org_id"`
		Username      string    `gorm:"column:username"`
	}

	var r row
	q := db.Table("sign_sessions as ss").
		Select("ss.id, ss.course_id, ss.room_id, ss.start_time, ss.end_time, ss.is_active, c.name as course_name, c.class_roster_id, c.member_mode, c.members, c.user_id, u.org_id, u.username").
		Joins("JOIN courses c ON c.id = ss.course_id").
		Joins("JOIN users u ON u.id = c.user_id").
		Where("ss.id = ?", sessionID).
		Where("ss.is_active = ?", false)
	if err := q.Take(&r).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			errorResponse(c, http.StatusNotFound, "场次不存在或未结束")
			return
		}
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	if claims.Role == "org_owner" && claims.OrgID != nil {
		if r.OrgID == nil || *r.OrgID != *claims.OrgID {
			errorResponse(c, http.StatusForbidden, "无权限导出该场次")
			return
		}
	} else {
		if r.UserID != claims.UserID {
			errorResponse(c, http.StatusForbidden, "无权限导出该场次")
			return
		}
	}

	var signIns []SignIn
	if err := db.Where("session_id = ?", r.ID).Find(&signIns).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询签到记录失败")
		return
	}

	parseMembers := func(raw string) map[string]string {
		out := make(map[string]string)
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return out
		}
		var arr []interface{}
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			return out
		}
		for _, it := range arr {
			switch v := it.(type) {
			case map[string]interface{}:
				sid := strings.TrimSpace(fmt.Sprintf("%v", v["studentId"]))
				if sid == "" || sid == "<nil>" {
					sid = strings.TrimSpace(fmt.Sprintf("%v", v["student_id"]))
				}
				if sid == "" || sid == "<nil>" {
					continue
				}
				name := strings.TrimSpace(fmt.Sprintf("%v", v["name"]))
				if name == "<nil>" {
					name = ""
				}
				out[sid] = name
			}
		}
		return out
	}

	expected := make(map[string]string)
	if r.MemberMode == "independent" {
		for sid, name := range parseMembers(r.Members) {
			expected[sid] = name
		}
	} else if r.MemberMode == "class" && strings.TrimSpace(r.ClassRosterID) != "" {
		if rid, err := strconv.ParseUint(strings.TrimSpace(r.ClassRosterID), 10, 64); err == nil && rid > 0 {
			var roster ClassRoster
			if err := db.First(&roster, uint(rid)).Error; err == nil {
				for sid, name := range parseMembers(roster.Members) {
					expected[sid] = name
				}
			}
		}
	}

	signed := make(map[string]SignIn)
	for _, si := range signIns {
		sid := strings.TrimSpace(si.StudentID)
		if sid == "" {
			continue
		}
		signed[sid] = si
	}

	leaveReason := make(map[string]string)
	{
		var leaves []SignLeave
		_ = db.Where("session_id = ?", r.ID).Find(&leaves).Error
		for _, lv := range leaves {
			sid := strings.TrimSpace(lv.StudentID)
			if sid == "" {
				continue
			}
			leaveReason[sid] = strings.TrimSpace(lv.Reason)
		}
	}

	buildWarnText := func(warnReasons string) string {
		parts := strings.Split(warnReasons, ",")
		out := make([]string, 0, len(parts))
		seen := make(map[string]bool, len(parts))
		for _, p := range parts {
			k := strings.TrimSpace(p)
			if k == "" || seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, ruleWarnText(k))
		}
		return strings.Join(out, "；")
	}

	signStatusText := func(si SignIn) (string, string) {
		warnText := buildWarnText(si.WarnReasons)
		status := "已签到"
		if strings.TrimSpace(si.Status) == "late" {
			status = "迟到"
		}
		if strings.TrimSpace(si.SignQuality) == "warn" {
			if status == "迟到" {
				status = "迟到(异常)"
			} else {
				status = "异常签到"
			}
		}
		return status, warnText
	}

	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	headers := []string{"学号", "姓名", "座位", "签到时间", "状态", "异常原因", "请假原因"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}

	rowNum := 2
	seenSigned := make(map[string]bool)
	if len(expected) > 0 {
		ids := make([]string, 0, len(expected))
		for sid := range expected {
			ids = append(ids, sid)
		}
		sort.Strings(ids)
		for _, sid := range ids {
			name := expected[sid]
			if si, ok := signed[sid]; ok {
				seenSigned[sid] = true
				stText, warnText := signStatusText(si)
				values := []interface{}{sid, func() string {
					if strings.TrimSpace(si.StudentName) != "" {
						return si.StudentName
					}
					return name
				}(), si.SeatLabel, si.Time.Format("2006-01-02 15:04:05"), stText, warnText, ""}
				for col, v := range values {
					cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
					f.SetCellValue(sheet, cell, v)
				}
			} else {
				if lr, ok := leaveReason[sid]; ok {
					values := []interface{}{sid, name, "", "", "请假", "", lr}
					for col, v := range values {
						cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
						f.SetCellValue(sheet, cell, v)
					}
				} else {
					values := []interface{}{sid, name, "", "", "缺勤", "", ""}
					for col, v := range values {
						cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
						f.SetCellValue(sheet, cell, v)
					}
				}
			}
			rowNum++
		}

		for _, si := range signIns {
			sid := strings.TrimSpace(si.StudentID)
			if sid == "" || seenSigned[sid] {
				continue
			}
			stText, warnText := signStatusText(si)
			if stText == "迟到" {
				stText = "迟到(非名单)"
			} else if stText == "迟到(异常)" {
				stText = "迟到(异常)(非名单)"
			} else if stText == "异常签到" {
				stText = "异常签到(非名单)"
			} else {
				stText = "已签到(非名单)"
			}
			values := []interface{}{sid, si.StudentName, si.SeatLabel, si.Time.Format("2006-01-02 15:04:05"), stText, warnText, ""}
			for col, v := range values {
				cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
				f.SetCellValue(sheet, cell, v)
			}
			rowNum++
		}
	} else {
		for _, si := range signIns {
			stText, warnText := signStatusText(si)
			values := []interface{}{si.StudentID, si.StudentName, si.SeatLabel, si.Time.Format("2006-01-02 15:04:05"), stText, warnText, ""}
			for col, v := range values {
				cell, _ := excelize.CoordinatesToCellName(col+1, rowNum)
				f.SetCellValue(sheet, cell, v)
			}
			rowNum++
		}
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "导出失败")
		return
	}

	filename := fmt.Sprintf("attendance_session_%d.xlsx", r.ID)
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf.Bytes())
}

// AISeatHeatmap 提供基于历史签到数据的座位使用热力图数据接口
func AISeatHeatmap(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}

	courseIDStr := strings.TrimSpace(c.Query("course_id"))
	courseID64, err := strconv.ParseUint(courseIDStr, 10, 64)
	if err != nil || courseID64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的 course_id")
		return
	}
	courseID := uint(courseID64)

	var course Course
	if err := db.First(&course, courseID).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}
	if !allowCourseAccess(db, claims, course) {
		errorResponse(c, http.StatusForbidden, "无权限查看该课程")
		return
	}

	fromStr := strings.TrimSpace(c.Query("from"))
	toStr := strings.TrimSpace(c.Query("to"))
	to := time.Now()
	from := to.Add(-30 * 24 * time.Hour)
	if t, ok := parseQueryTime(fromStr, false); ok {
		from = t
	}
	if t, ok := parseQueryTime(toStr, true); ok {
		to = t
	}

	type seatCnt struct {
		SeatLabel string `gorm:"column:seat_label"`
		Cnt       int64  `gorm:"column:cnt"`
	}
	var rows []seatCnt
	if err := db.Table("sign_ins as si").
		Select("si.seat_label as seat_label, COUNT(*) as cnt").
		Joins("JOIN sign_sessions ss ON ss.id = si.session_id").
		Where("ss.course_id = ? AND ss.start_time >= ? AND ss.start_time <= ?", course.ID, from, to).
		Group("si.seat_label").
		Scan(&rows).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}
	counts := make(map[string]int64, len(rows))
	var maxCnt int64
	var total int64
	for _, r := range rows {
		sl := strings.TrimSpace(r.SeatLabel)
		if sl == "" {
			continue
		}
		counts[sl] = r.Cnt
		total += r.Cnt
		if r.Cnt > maxCnt {
			maxCnt = r.Cnt
		}
	}

	var seatPos interface{}
	if strings.TrimSpace(course.Location) != "" {
		var room Room
		if err := db.Where("room_id = ? AND org_id = ?", course.Location, *claims.OrgID).First(&room).Error; err == nil {
			if strings.TrimSpace(room.Seat_pos) != "" {
				var tmp interface{}
				if err := json.Unmarshal([]byte(room.Seat_pos), &tmp); err == nil {
					seatPos = tmp
				} else {
					seatPos = room.Seat_pos
				}
			}
		}
	}

	successResponse(c, gin.H{
		"course_id": course.ID,
		"room_id":   course.Location,
		"from":      from,
		"to":        to,
		"counts":    counts,
		"max_count": maxCnt,
		"total":     total,
		"seat_pos":  seatPos,
	})
}

// AIAnomalies 获取当前课程的 AI 离群值预警记录，供前端展示
func AIAnomalies(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	courseIDStr := strings.TrimSpace(c.Query("course_id"))
	courseID64, err := strconv.ParseUint(courseIDStr, 10, 64)
	if err != nil || courseID64 == 0 {
		errorResponse(c, http.StatusBadRequest, "无效的 course_id")
		return
	}
	courseID := uint(courseID64)

	var course Course
	if err := db.First(&course, courseID).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}
	if !allowCourseAccess(db, claims, course) {
		errorResponse(c, http.StatusForbidden, "无权限查看该课程")
		return
	}

	fromStr := strings.TrimSpace(c.Query("from"))
	toStr := strings.TrimSpace(c.Query("to"))
	to := time.Now()
	from := to.Add(-30 * 24 * time.Hour)
	if t, ok := parseQueryTime(fromStr, false); ok {
		from = t
	}
	if t, ok := parseQueryTime(toStr, true); ok {
		to = t
	}

	type row struct {
		ID        uint      `gorm:"column:id"`
		SessionID uint      `gorm:"column:session_id"`
		StudentID string    `gorm:"column:student_id"`
		Kind      string    `gorm:"column:kind"`
		Score     float64   `gorm:"column:score"`
		Message   string    `gorm:"column:message"`
		SeatLabel string    `gorm:"column:seat_label"`
		CreatedAt time.Time `gorm:"column:created_at"`
		StartTime time.Time `gorm:"column:start_time"`
	}
	var rows []row
	if err := db.Table("sign_anomaly_alerts as a").
		Select("a.id, a.session_id, a.student_id, a.kind, a.score, a.message, a.seat_label, a.created_at, ss.start_time").
		Joins("JOIN sign_sessions ss ON ss.id = a.session_id").
		Where("ss.course_id = ? AND ss.start_time >= ? AND ss.start_time <= ?", course.ID, from, to).
		Order("a.created_at desc").
		Limit(500).
		Scan(&rows).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"id":         r.ID,
			"session_id": r.SessionID,
			"student_id": r.StudentID,
			"kind":       r.Kind,
			"score":      r.Score,
			"message":    r.Message,
			"seat_label": r.SeatLabel,
			"created_at": r.CreatedAt,
			"start_time": r.StartTime,
		})
	}
	successResponse(c, gin.H{"alerts": out, "from": from, "to": to})
}

// MembersTemplate 处理相关逻辑
func MembersTemplate(db *gorm.DB, c *gin.Context) {
	_, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}

	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	_ = f.SetCellValue(sheet, "A1", "姓名")
	_ = f.SetCellValue(sheet, "B1", "学号")
	_ = f.SetCellValue(sheet, "A2", "张三")
	_ = f.SetCellValue(sheet, "B2", "20230001")
	_ = f.SetCellValue(sheet, "A3", "李四")
	_ = f.SetCellValue(sheet, "B3", "20230002")
	_ = f.SetColWidth(sheet, "A", "A", 16)
	_ = f.SetColWidth(sheet, "B", "B", 18)

	buf, err := f.WriteToBuffer()
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "生成模板失败")
		return
	}

	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", "attachment; filename=\"members_template.xlsx\"")
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf.Bytes())
}

// MembersImport 处理相关逻辑
func MembersImport(db *gorm.DB, c *gin.Context) {
	_, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "缺少文件")
		return
	}
	if file.Size <= 0 || file.Size > 5*1024*1024 {
		errorResponse(c, http.StatusBadRequest, "文件大小不合法")
		return
	}

	fh, err := file.Open()
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "读取文件失败")
		return
	}
	defer fh.Close()

	xl, err := excelize.OpenReader(fh)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "解析Excel失败")
		return
	}

	sheet := xl.GetSheetName(0)
	if strings.TrimSpace(sheet) == "" {
		errorResponse(c, http.StatusBadRequest, "Excel无工作表")
		return
	}

	rows, err := xl.GetRows(sheet)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "读取Excel失败")
		return
	}
	if len(rows) == 0 {
		successResponse(c, gin.H{"members": []interface{}{}})
		return
	}

	header := rows[0]
	nameIdx := -1
	idIdx := -1
	for i, h := range header {
		h = strings.ToLower(strings.TrimSpace(h))
		switch h {
		case "姓名", "名字", "name", "studentname":
			if nameIdx == -1 {
				nameIdx = i
			}
		case "学号", "studentid", "student_id", "id":
			if idIdx == -1 {
				idIdx = i
			}
		}
	}
	if nameIdx == -1 && idIdx == -1 {
		nameIdx = 0
		idIdx = 1
	}
	if nameIdx == -1 {
		nameIdx = 0
	}
	if idIdx == -1 {
		idIdx = 1
	}

	normalizeID := func(s string) string {
		s = strings.TrimSpace(s)
		if strings.HasSuffix(s, ".0") {
			base := strings.TrimSuffix(s, ".0")
			if base != "" {
				allDigits := true
				for _, r := range base {
					if r < '0' || r > '9' {
						allDigits = false
						break
					}
				}
				if allDigits {
					return base
				}
			}
		}
		return s
	}

	type member struct {
		Name      string `json:"name"`
		StudentID string `json:"studentId"`
	}

	out := make([]member, 0, len(rows)-1)
	seen := make(map[string]bool)
	for _, r := range rows[1:] {
		var name string
		var sid string
		if nameIdx >= 0 && nameIdx < len(r) {
			name = strings.TrimSpace(r[nameIdx])
		}
		if idIdx >= 0 && idIdx < len(r) {
			sid = normalizeID(r[idIdx])
		}
		if name == "" && sid == "" {
			continue
		}
		key := sid
		if key == "" {
			key = "name:" + strings.ToLower(name)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, member{Name: name, StudentID: sid})
	}

	successResponse(c, gin.H{"members": out})
}

// 创建签到记录 (学生端调用)
func PostSignIn(db *gorm.DB, c *gin.Context) {
	var req struct {
		SessionID   uint    `json:"session_id"`
		CourseID    uint    `json:"course_id"`
		StudentID   string  `json:"student_id"`
		StudentName string  `json:"student_name"`
		SeatLabel   string  `json:"seat_label"`
		DeviceID    string  `json:"device_id"`
		Latitude    float64 `json:"latitude"`
		Longitude   float64 `json:"longitude"`
		Confirm     bool    `json:"confirm_abnormal"`

		Ver  string `json:"ver"`
		Seat string `json:"seat"`
		Room string `json:"room"`
		Iat  string `json:"iat"`
		Ttl  string `json:"ttl"`
		Sig  string `json:"sig"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的数据格式")
		return
	}

	v, ok := c.Get("wxClaims")
	wxClaims := WxClaims{}
	if ok {
		wxClaims = v.(WxClaims)
	}
	openid := strings.TrimSpace(wxClaims.OpenID)
	wxAuthInvalid, _ := c.Get("wxAuthInvalid")
	authInvalid := (openid == "") || (wxAuthInvalid == true)

	req.StudentID = strings.TrimSpace(req.StudentID)
	req.StudentName = strings.TrimSpace(req.StudentName)
	req.SeatLabel = strings.TrimSpace(req.SeatLabel)
	req.DeviceID = strings.TrimSpace(req.DeviceID)

	if req.StudentID == "" {
		errorResponse(c, http.StatusBadRequest, "缺少学生学号")
		return
	}
	if req.StudentName == "" {
		errorResponse(c, http.StatusBadRequest, "缺少学生姓名")
		return
	}

	seatLabel := req.SeatLabel
	if seatLabel == "" {
		seatLabel = strings.TrimSpace(req.Seat)
	}
	if seatLabel == "" {
		errorResponse(c, http.StatusBadRequest, "缺少座位号")
		return
	}
	seatLabel = filepath.Base(seatLabel)

	roomID := strings.TrimSpace(req.Room)
	if roomID != "" {
		roomID = filepath.Base(roomID)
	}

	if strings.TrimSpace(req.Sig) != "" || roomID != "" || strings.TrimSpace(req.Seat) != "" {
		if roomID == "" || strings.TrimSpace(req.Seat) == "" || strings.TrimSpace(req.Sig) == "" {
			errorResponse(c, http.StatusBadRequest, "二维码字段不完整")
			return
		}
		qr := QRcode{
			Ver:  safeBase(req.Ver),
			Seat: safeBase(req.Seat),
			Room: roomID,
			Iat:  safeBase(req.Iat),
			Ttl:  safeBase(req.Ttl),
			Sig:  strings.TrimSpace(req.Sig),
		}
		ok, err := verifyQRcode(qr)
		if err != nil || !ok {
			errorResponse(c, http.StatusBadRequest, "二维码校验失败")
			return
		}
	}

	qrSeat := safeBase(req.Seat)
	if qrSeat != "" && qrSeat != seatLabel {
		errorResponse(c, http.StatusBadRequest, "座位号与二维码不一致")
		return
	}

	// 查找 Active Session
	var session SignSession
	if req.SessionID > 0 {
		if err := db.First(&session, req.SessionID).Error; err != nil {
			errorResponse(c, http.StatusNotFound, "签到场次不存在或已结束")
			return
		}
	} else if req.CourseID > 0 {
		if err := db.Where("course_id = ? AND is_active = ?", req.CourseID, true).Last(&session).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				if err2 := db.Where("course_id = ?", req.CourseID).Last(&session).Error; err2 != nil {
					errorResponse(c, http.StatusBadRequest, "当前课程无正在进行的签到")
					return
				}
			} else {
				errorResponse(c, http.StatusBadRequest, "当前课程无正在进行的签到")
				return
			}
		}
	} else if roomID != "" {
		if err := db.Where("room_id = ? AND is_active = ?", roomID, true).Last(&session).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				if err2 := db.Where("room_id = ?", roomID).Last(&session).Error; err2 != nil {
					errorResponse(c, http.StatusBadRequest, "当前教室无正在进行的签到")
					return
				}
			} else {
				errorResponse(c, http.StatusBadRequest, "当前教室无正在进行的签到")
				return
			}
		}
	} else {
		errorResponse(c, http.StatusBadRequest, "缺少签到场次信息")
		return
	}

	var course Course
	if err := db.First(&course, session.CourseID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "课程不存在")
		return
	}

	// 检查是否迟到
	isLate := false
	now := time.Now()

	// 如果签到场次已结束，需要检查是否在课程时间内
	if !session.IsActive {
		checkT := session.EndTime
		if checkT.IsZero() {
			checkT = session.StartTime
		}
		if !checkT.IsZero() {
			if checkT.Year() != now.Year() || checkT.Month() != now.Month() || checkT.Day() != now.Day() {
				errorResponse(c, http.StatusBadRequest, "签到已结束")
				return
			}
		}

		// 获取课程关联的学期，以获取时间槽信息
		var semester Semester
		if err := db.First(&semester, course.SemesterID).Error; err != nil {
			errorResponse(c, http.StatusBadRequest, "签到已结束")
			return
		}

		if course.DayIndex >= 0 {
			nowDayIndex := int((now.Weekday() + 6) % 7)
			if nowDayIndex != course.DayIndex {
				errorResponse(c, http.StatusBadRequest, "签到已结束")
				return
			}
		}

		type slot struct {
			Start string `json:"start"`
			End   string `json:"end"`
		}
		timeSlots := make([]slot, 0, 16)
		if strings.TrimSpace(semester.TimeSlots) != "" {
			_ = json.Unmarshal([]byte(semester.TimeSlots), &timeSlots)
		}
		if len(timeSlots) == 0 {
			timeSlots = []slot{
				{Start: "08:00", End: "08:45"},
				{Start: "08:55", End: "09:40"},
				{Start: "10:00", End: "10:45"},
				{Start: "10:55", End: "11:40"},
				{Start: "14:00", End: "14:45"},
				{Start: "14:55", End: "15:40"},
				{Start: "16:00", End: "16:45"},
				{Start: "16:55", End: "17:40"},
				{Start: "19:00", End: "19:45"},
				{Start: "19:55", End: "20:40"},
				{Start: "20:50", End: "21:35"},
			}
		}

		if course.StartSlotIndex < 0 || course.StartSlotIndex >= len(timeSlots) || course.EndSlotIndex < 0 || course.EndSlotIndex >= len(timeSlots) {
			errorResponse(c, http.StatusBadRequest, "签到已结束")
			return
		}

		startTimeParts := strings.Split(strings.TrimSpace(timeSlots[course.StartSlotIndex].Start), ":")
		endTimeParts := strings.Split(strings.TrimSpace(timeSlots[course.EndSlotIndex].End), ":")
		if len(startTimeParts) != 2 || len(endTimeParts) != 2 {
			errorResponse(c, http.StatusBadRequest, "签到已结束")
			return
		}
		startHour, err1 := strconv.Atoi(startTimeParts[0])
		startMin, err2 := strconv.Atoi(startTimeParts[1])
		endHour, err3 := strconv.Atoi(endTimeParts[0])
		endMin, err4 := strconv.Atoi(endTimeParts[1])
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			errorResponse(c, http.StatusBadRequest, "签到已结束")
			return
		}

		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		courseStartTime := today.Add(time.Duration(startHour)*time.Hour + time.Duration(startMin)*time.Minute)
		courseEndTime := today.Add(time.Duration(endHour)*time.Hour + time.Duration(endMin)*time.Minute)
		if !now.Before(courseStartTime) && !now.After(courseEndTime) {
			isLate = true
		} else {
			errorResponse(c, http.StatusBadRequest, "签到已结束")
			return
		}
	}

	abnormalReasons := make([]string, 0, 4)
	if authInvalid {
		abnormalReasons = append(abnormalReasons, "auth_invalid")
	}

	if course.BSSIDEnabled {
		if strings.TrimSpace(req.DeviceID) == "" {
			abnormalReasons = append(abnormalReasons, "wifi_missing")
		} else if !bssidAllowed(course.BSSIDList, req.DeviceID) {
			abnormalReasons = append(abnormalReasons, "wifi_not_whitelisted")
		}
	}

	if course.IPEnabled {
		normalized := normalizeIPList(course.IPList)
		if strings.TrimSpace(normalized) == "" {
			errorResponse(c, http.StatusInternalServerError, "课程未正确配置出口IP校验")
			return
		}
		rawIP := strings.TrimSpace(c.ClientIP())
		if !ipAllowed(normalized, rawIP) {
			abnormalReasons = append(abnormalReasons, "ip_not_whitelisted")
		}
	}

	if course.GPSEnabled {
		if req.Latitude == 0 || req.Longitude == 0 {
			abnormalReasons = append(abnormalReasons, "gps_missing")
		} else {
			if course.GPSLat == 0 || course.GPSLng == 0 || course.GPSRadiusM <= 0 {
				errorResponse(c, http.StatusInternalServerError, "课程未正确配置GPS校验")
				return
			}
			d := distanceMeters(req.Latitude, req.Longitude, course.GPSLat, course.GPSLng)
			if d > float64(course.GPSRadiusM) {
				abnormalReasons = append(abnormalReasons, "gps_out_of_range")
			}
		}
	}

	if len(abnormalReasons) > 0 && !req.Confirm {
		c.JSON(http.StatusOK, Response{
			Code:    1001,
			Message: "检测到异常签到，请确认后继续",
			Data: gin.H{
				"reasons": abnormalReasons,
			},
		})
		return
	}

	if course.FixedSeatEnabled {
		var fs CourseFixedSeat
		if err := db.Where("course_id = ? AND student_id = ?", course.ID, req.StudentID).First(&fs).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				errorResponse(c, http.StatusBadRequest, "未分配固定座位")
				return
			}
			errorResponse(c, http.StatusInternalServerError, "固定座位校验失败")
			return
		}
		if strings.TrimSpace(fs.SeatLabel) == "" {
			errorResponse(c, http.StatusInternalServerError, "固定座位配置异常")
			return
		}
		if fs.SeatLabel != seatLabel {
			errorResponse(c, http.StatusBadRequest, fmt.Sprintf("固定座位为 %s", fs.SeatLabel))
			return
		}
	}

	var openIDPtr *string
	if openid != "" {
		openIDPtr = &openid
	}
	signQuality := "ok"
	warnReasons := ""
	if len(abnormalReasons) > 0 {
		signQuality = "warn"
		warnReasons = strings.Join(abnormalReasons, ",")
	}

	var existing SignIn
	existingErr := db.Where("session_id = ? AND student_id = ?", session.ID, req.StudentID).First(&existing).Error
	if existingErr == nil {
		if strings.TrimSpace(existing.SignQuality) == "warn" && signQuality == "ok" {
			if openid != "" {
				var other SignIn
				if err := db.Where("session_id = ? AND open_id = ? AND id <> ?", session.ID, openid, existing.ID).First(&other).Error; err == nil {
					errorResponse(c, http.StatusBadRequest, "请勿重复签到")
					return
				} else if err != nil && err != gorm.ErrRecordNotFound {
					errorResponse(c, http.StatusInternalServerError, "签到失败")
					return
				}
			}

			var otherSeat SignIn
			if err := db.Where("session_id = ? AND seat_label = ? AND id <> ?", session.ID, seatLabel, existing.ID).First(&otherSeat).Error; err == nil {
				errorResponse(c, http.StatusBadRequest, "该座位已被占用")
				return
			} else if err != nil && err != gorm.ErrRecordNotFound {
				errorResponse(c, http.StatusInternalServerError, "签到失败")
				return
			}

			now := time.Now()
			status := "success"
			if isLate {
				status = "late"
			}
			updates := map[string]interface{}{
				"student_name": req.StudentName,
				"open_id":      openIDPtr,
				"seat_label":   seatLabel,
				"time":         now,
				"ip":           c.ClientIP(),
				"device_id":    req.DeviceID,
				"status":       status,
				"sign_quality": "ok",
				"warn_reasons": "",
			}
			if err := db.Model(&SignIn{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
				errorResponse(c, http.StatusInternalServerError, "签到失败")
				return
			}
			if redisClient != nil {
				_ = redisClient.Del(c.Request.Context(), cacheKeySessionSignIns(session.ID)).Err()
			}

			prevReasons := strings.Split(strings.TrimSpace(existing.WarnReasons), ",")
			kinds := make([]string, 0, len(prevReasons))
			for _, r := range prevReasons {
				r = strings.TrimSpace(r)
				if r == "" {
					continue
				}
				kinds = append(kinds, "rule_"+r)
			}
			if len(kinds) > 0 {
				_ = db.Where("session_id = ? AND student_id = ? AND kind IN ?", session.ID, req.StudentID, kinds).Delete(&SignAnomalyAlert{}).Error
			}

			generateSignInAnomalies(db, session, course, req.StudentID, req.StudentName, seatLabel, now)
			msg := "签到成功"
			if status == "late" {
				msg = "迟到签到成功"
			}
			successResponse(c, gin.H{"message": msg, "status": status})
			return
		}
		errorResponse(c, http.StatusBadRequest, "请勿重复签到")
		return
	} else if existingErr != nil && existingErr != gorm.ErrRecordNotFound {
		errorResponse(c, http.StatusInternalServerError, "签到失败")
		return
	}

	if openid != "" {
		var openIDCount int64
		db.Model(&SignIn{}).Where("session_id = ? AND open_id = ?", session.ID, openid).Count(&openIDCount)
		if openIDCount > 0 {
			errorResponse(c, http.StatusBadRequest, "请勿重复签到")
			return
		}
	}

	var count int64
	db.Model(&SignIn{}).Where("session_id = ? AND seat_label = ?", session.ID, seatLabel).Count(&count)
	if count > 0 {
		errorResponse(c, http.StatusBadRequest, "该座位已被占用")
		return
	}
	status := "success"
	if isLate {
		status = "late"
	}
	signIn := SignIn{
		SessionID:   session.ID,
		StudentID:   req.StudentID,
		StudentName: req.StudentName,
		OpenID:      openIDPtr,
		SeatLabel:   seatLabel,
		Time:        time.Now(),
		Ip:          c.ClientIP(),
		DeviceID:    req.DeviceID,
		Status:      status,
		SignQuality: signQuality,
		WarnReasons: warnReasons,
	}

	if err := db.Create(&signIn).Error; err != nil {
		if strings.Contains(err.Error(), "Duplicate entry") {
			if strings.Contains(err.Error(), "uniq_session_student") {
				errorResponse(c, http.StatusBadRequest, "请勿重复签到")
				return
			}
			if strings.Contains(err.Error(), "uniq_session_seat") {
				errorResponse(c, http.StatusBadRequest, "该座位已被占用")
				return
			}
		}
		errorResponse(c, http.StatusInternalServerError, "签到失败")
		return
	}
	if redisClient != nil {
		_ = redisClient.Del(c.Request.Context(), cacheKeySessionSignIns(session.ID)).Err()
	}

	if signQuality == "warn" {
		for _, r := range abnormalReasons {
			k := "rule_" + strings.TrimSpace(r)
			createSessionAlert(db, session.ID, req.StudentID, k, 1.0, "异常签到："+ruleWarnText(r), seatLabel)
		}
	}
	generateSignInAnomalies(db, session, course, req.StudentID, req.StudentName, seatLabel, signIn.Time)

	msg := "签到成功"
	if status == "late" {
		msg = "迟到签到成功"
	}
	successResponse(c, gin.H{"message": msg, "status": status})
}

// WxLogin 处理微信小程序端通过 code 换取 OpenID 和 SessionKey 的登录流程
func WxLogin(db *gorm.DB, c *gin.Context) {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("wx_login bad_request: ip=%s err=%v", c.ClientIP(), err)
		errorResponse(c, http.StatusBadRequest, "无效的数据格式")
		return
	}
	req.Code = strings.TrimSpace(req.Code)
	if req.Code == "" {
		log.Printf("wx_login bad_request: ip=%s missing_code", c.ClientIP())
		errorResponse(c, http.StatusBadRequest, "缺少 code")
		return
	}

	appid := strings.TrimSpace(WeChatAppID)
	secret := strings.TrimSpace(WeChatSecret)
	if appid == "" || secret == "" {
		log.Printf("wx_login misconfig: ip=%s missing_appid_or_secret", c.ClientIP())
		errorResponse(c, http.StatusInternalServerError, "服务未配置微信登录")
		return
	}

	u, _ := url.Parse("https://api.weixin.qq.com/sns/jscode2session")
	q := u.Query()
	q.Set("appid", appid)
	q.Set("secret", secret)
	q.Set("js_code", req.Code)
	q.Set("grant_type", "authorization_code")
	u.RawQuery = q.Encode()

	start := time.Now()
	client := &http.Client{Timeout: 6 * time.Second}
	resp, err := client.Get(u.String())
	if err != nil {
		log.Printf("wx_login wechat_request_error: ip=%s dur_ms=%d err=%v", c.ClientIP(), time.Since(start).Milliseconds(), err)
		errorResponse(c, http.StatusBadRequest, "微信登录失败")
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var out struct {
		OpenID     string `json:"openid"`
		SessionKey string `json:"session_key"`
		UnionID    string `json:"unionid"`
		ErrCode    int    `json:"errcode"`
		ErrMsg     string `json:"errmsg"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		log.Printf("wx_login bad_wechat_response: ip=%s dur_ms=%d status=%d body_len=%d err=%v", c.ClientIP(), time.Since(start).Milliseconds(), resp.StatusCode, len(raw), err)
		errorResponse(c, http.StatusBadRequest, "微信登录失败")
		return
	}
	if out.ErrCode != 0 || strings.TrimSpace(out.OpenID) == "" {
		log.Printf("wx_login wechat_error: ip=%s dur_ms=%d status=%d errcode=%d errmsg=%q", c.ClientIP(), time.Since(start).Milliseconds(), resp.StatusCode, out.ErrCode, out.ErrMsg)
		errorResponse(c, http.StatusBadRequest, "微信登录失败")
		return
	}

	token, err := signWxToken(WxClaims{
		OpenID: out.OpenID,
		Exp:    time.Now().Add(30 * 24 * time.Hour).Unix(),
	})
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "登录失败")
		return
	}
	successResponse(c, gin.H{
		"token": token,
	})
}

// CreateSignRequest (已废弃，保留用于兼容旧代码查找)
// type CreateSignRequest struct {
// 	ID           int       `json:"id"`
// 	Org_id       *int      `json:"org_id,omitempty"`
// 	Create_time  time.Time `json:"time"`
// 	Sign_message string    `json:"sign_message"`
// }

type AuthClaims struct {
	UserID    uint   `json:"uid"`
	Username  string `json:"u"`
	Role      string `json:"r"`
	OrgID     *uint  `json:"oid,omitempty"`
	OrgStatus string `json:"os"`
	Exp       int64  `json:"exp"`
}

type WxClaims struct {
	OpenID string `json:"oid"`
	Exp    int64  `json:"exp"`
}

// wxAuthSecretKey 处理相关逻辑
func wxAuthSecretKey() string {
	s := strings.TrimSpace(os.Getenv("WX_AUTH_SECRET"))
	if s == "" {
		return AuthSecretKey
	}
	return s
}

// signAuthToken 处理相关逻辑
func signAuthToken(claims AuthClaims) (string, error) {
	b, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(b)
	sig := HmacSha256ToBase64(AuthSecretKey, payload)
	sig = strings.TrimRight(sig, "=")
	sig = strings.ReplaceAll(sig, "+", "-")
	sig = strings.ReplaceAll(sig, "/", "_")
	return payload + "." + sig, nil
}

// verifyAuthToken 处理相关逻辑
func verifyAuthToken(token string) (*AuthClaims, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, false
	}
	payload := parts[0]
	sig := parts[1]

	expected := HmacSha256ToBase64(AuthSecretKey, payload)
	expected = strings.TrimRight(expected, "=")
	expected = strings.ReplaceAll(expected, "+", "-")
	expected = strings.ReplaceAll(expected, "/", "_")
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return nil, false
	}

	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	var claims AuthClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return nil, false
	}
	if claims.Exp <= time.Now().Unix() {
		return nil, false
	}
	return &claims, true
}

// signWxToken 处理相关逻辑
func signWxToken(claims WxClaims) (string, error) {
	b, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(b)
	sig := HmacSha256ToBase64(wxAuthSecretKey(), payload)
	sig = strings.TrimRight(sig, "=")
	sig = strings.ReplaceAll(sig, "+", "-")
	sig = strings.ReplaceAll(sig, "/", "_")
	return payload + "." + sig, nil
}

// verifyWxToken 处理相关逻辑
func verifyWxToken(token string) (*WxClaims, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, false
	}
	payload := parts[0]
	sig := parts[1]

	expected := HmacSha256ToBase64(wxAuthSecretKey(), payload)
	expected = strings.TrimRight(expected, "=")
	expected = strings.ReplaceAll(expected, "+", "-")
	expected = strings.ReplaceAll(expected, "/", "_")
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return nil, false
	}

	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	var claims WxClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return nil, false
	}
	if claims.Exp <= time.Now().Unix() {
		return nil, false
	}
	if strings.TrimSpace(claims.OpenID) == "" {
		return nil, false
	}
	return &claims, true
}

// authMiddleware 处理相关逻辑
func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			errorResponse(c, http.StatusUnauthorized, "未登录")
			c.Abort()
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		claims, ok := verifyAuthToken(token)
		if !ok {
			errorResponse(c, http.StatusUnauthorized, "登录已失效")
			c.Abort()
			return
		}
		c.Set("authClaims", *claims)
		c.Next()
	}
}

// wxAuthMiddleware 处理相关逻辑
func wxAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.Set("wxClaims", WxClaims{})
			c.Set("wxAuthInvalid", true)
			c.Next()
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		claims, ok := verifyWxToken(token)
		if !ok {
			c.Set("wxClaims", WxClaims{})
			c.Set("wxAuthInvalid", true)
			c.Next()
			return
		}
		c.Set("wxClaims", *claims)
		c.Next()
	}
}

type RegisterRequest struct {
	Username     string `json:"username"`
	Password     string `json:"password"`
	RegisterMode string `json:"register_mode"` // user | org_creator
	OrgID        uint   `json:"org_id"`
	OrgName      string `json:"org_name"`
}

// Register 处理相关逻辑
func Register(db *gorm.DB, c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据格式")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.OrgName = strings.TrimSpace(req.OrgName)

	if req.Username == "" || req.Password == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要字段: username 或 password")
		return
	}
	if req.RegisterMode != "user" && req.RegisterMode != "org_creator" {
		errorResponse(c, http.StatusBadRequest, "register_mode 必须为 user 或 org_creator")
		return
	}

	var existing User
	if err := db.Where("username = ?", req.Username).First(&existing).Error; err == nil {
		errorResponse(c, http.StatusBadRequest, "用户名已存在")
		return
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "密码处理失败")
		return
	}
	hash := string(hashBytes)

	if req.RegisterMode == "org_creator" {
		if req.OrgName == "" {
			errorResponse(c, http.StatusBadRequest, "缺少必要字段: org_name")
			return
		}
		tx := db.Begin()
		if tx.Error != nil {
			errorResponse(c, http.StatusInternalServerError, "数据库错误")
			return
		}

		user := User{
			Username:     req.Username,
			PasswordHash: hash,
			Role:         "org_owner",
			OrgStatus:    "approved",
		}
		if err := tx.Create(&user).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "创建用户失败")
			return
		}

		org := Organization{
			Name:        req.OrgName,
			OwnerUserID: user.ID,
		}
		if err := tx.Create(&org).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "创建组织失败")
			return
		}

		if err := tx.Model(&user).Updates(map[string]interface{}{"org_id": org.ID}).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "更新用户组织失败")
			return
		}

		if err := tx.Commit().Error; err != nil {
			errorResponse(c, http.StatusInternalServerError, "数据库提交失败")
			return
		}

		successResponse(c, gin.H{
			"user": gin.H{
				"id":         user.ID,
				"username":   user.Username,
				"role":       user.Role,
				"org_status": "approved",
				"org_id":     org.ID,
			},
			"org": org,
		})
		return
	}

	if req.OrgID == 0 {
		tx := db.Begin()
		if tx.Error != nil {
			errorResponse(c, http.StatusInternalServerError, "数据库错误")
			return
		}

		user := User{
			Username:     req.Username,
			PasswordHash: hash,
			Role:         "org_owner",
			OrgStatus:    "approved",
		}
		if err := tx.Create(&user).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "创建用户失败")
			return
		}

		org := Organization{
			Name:        fmt.Sprintf("%s 的个人组织", req.Username),
			OwnerUserID: user.ID,
		}
		if err := tx.Create(&org).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "创建个人组织失败")
			return
		}

		if err := tx.Model(&user).Updates(map[string]interface{}{"org_id": org.ID}).Error; err != nil {
			tx.Rollback()
			errorResponse(c, http.StatusInternalServerError, "更新用户组织失败")
			return
		}

		if err := tx.Commit().Error; err != nil {
			errorResponse(c, http.StatusInternalServerError, "数据库提交失败")
			return
		}

		successResponse(c, gin.H{
			"user": gin.H{
				"id":         user.ID,
				"username":   user.Username,
				"role":       user.Role,
				"org_status": "approved",
				"org_id":     org.ID,
			},
			"org": org,
		})
		return
	}

	var org Organization
	if err := db.First(&org, req.OrgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "所属组织不存在")
		return
	}
	pendingID := req.OrgID
	user := User{
		Username:     req.Username,
		PasswordHash: hash,
		Role:         "user",
		PendingOrgID: &pendingID,
		OrgStatus:    "pending",
	}
	if err := db.Create(&user).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "创建用户失败")
		return
	}
	successResponse(c, gin.H{
		"user": gin.H{
			"id":             user.ID,
			"username":       user.Username,
			"role":           user.Role,
			"org_status":     user.OrgStatus,
			"pending_org_id": req.OrgID,
		},
	})
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Login 处理相关逻辑
func Login(db *gorm.DB, c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据格式")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要字段: username 或 password")
		return
	}
	var user User
	if err := db.Where("username = ?", req.Username).First(&user).Error; err != nil {
		errorResponse(c, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		errorResponse(c, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	claims := AuthClaims{
		UserID:    user.ID,
		Username:  user.Username,
		Role:      user.Role,
		OrgID:     user.OrgID,
		OrgStatus: user.OrgStatus,
		Exp:       time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	token, err := signAuthToken(claims)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "生成登录凭证失败")
		return
	}
	successResponse(c, gin.H{
		"token": token,
		"user": gin.H{
			"id":             user.ID,
			"username":       user.Username,
			"role":           user.Role,
			"org_id":         user.OrgID,
			"pending_org_id": user.PendingOrgID,
			"org_status":     user.OrgStatus,
		},
	})
}

// GetMe 处理相关逻辑
func GetMe(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	var user User
	if err := db.First(&user, claims.UserID).Error; err != nil {
		errorResponse(c, http.StatusUnauthorized, "用户不存在")
		return
	}
	successResponse(c, gin.H{
		"id":             user.ID,
		"username":       user.Username,
		"role":           user.Role,
		"org_id":         user.OrgID,
		"pending_org_id": user.PendingOrgID,
		"org_status":     user.OrgStatus,
	})
}

// ListOrganizations 处理相关逻辑
func ListOrganizations(db *gorm.DB, c *gin.Context) {
	var orgs []Organization
	if err := db.Order("id desc").Find(&orgs).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询组织失败")
		return
	}
	successResponse(c, gin.H{"orgs": orgs})
}

// ListPendingUsers 处理相关逻辑
func ListPendingUsers(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	orgID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的组织 id")
		return
	}
	orgID := uint(orgID64)

	if claims.Role != "org_owner" || claims.OrgID == nil || *claims.OrgID != orgID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var org Organization
	if err := db.First(&org, orgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "组织不存在")
		return
	}
	if org.OwnerUserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var users []User
	if err := db.Where("pending_org_id = ? AND org_status = ?", orgID, "pending").Order("id asc").Find(&users).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询待审核用户失败")
		return
	}
	list := make([]gin.H, 0, len(users))
	for _, u := range users {
		list = append(list, gin.H{
			"id":             u.ID,
			"username":       u.Username,
			"pending_org_id": u.PendingOrgID,
			"org_status":     u.OrgStatus,
		})
	}
	successResponse(c, gin.H{"users": list})
}

// ApprovePendingUser 处理相关逻辑
func ApprovePendingUser(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	orgID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的组织 id")
		return
	}
	orgID := uint(orgID64)
	userID64, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的用户 id")
		return
	}
	userID := uint(userID64)

	if claims.Role != "org_owner" || claims.OrgID == nil || *claims.OrgID != orgID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var org Organization
	if err := db.First(&org, orgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "组织不存在")
		return
	}
	if org.OwnerUserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var user User
	if err := db.First(&user, userID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "用户不存在")
		return
	}
	if user.PendingOrgID == nil || *user.PendingOrgID != orgID || user.OrgStatus != "pending" {
		errorResponse(c, http.StatusBadRequest, "该用户不在待审核状态")
		return
	}

	if err := db.Model(&user).Updates(map[string]interface{}{
		"org_id":         orgID,
		"pending_org_id": nil,
		"org_status":     "approved",
	}).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "审批失败")
		return
	}
	successResponse(c, gin.H{"message": "已批准"})
}

// RejectPendingUser 处理相关逻辑
func RejectPendingUser(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	orgID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的组织 id")
		return
	}
	orgID := uint(orgID64)
	userID64, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的用户 id")
		return
	}
	userID := uint(userID64)

	if claims.Role != "org_owner" || claims.OrgID == nil || *claims.OrgID != orgID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var org Organization
	if err := db.First(&org, orgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "组织不存在")
		return
	}
	if org.OwnerUserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var user User
	if err := db.First(&user, userID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "用户不存在")
		return
	}
	if user.PendingOrgID == nil || *user.PendingOrgID != orgID || user.OrgStatus != "pending" {
		errorResponse(c, http.StatusBadRequest, "该用户不在待审核状态")
		return
	}

	if err := db.Model(&user).Updates(map[string]interface{}{
		"pending_org_id": nil,
		"org_status":     "none",
	}).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "驳回失败")
		return
	}
	successResponse(c, gin.H{"message": "已驳回"})
}

// ApplyToOrganization 处理相关逻辑
func ApplyToOrganization(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	orgID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的组织 id")
		return
	}
	orgID := uint(orgID64)

	var org Organization
	if err := db.First(&org, orgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "所属组织不存在")
		return
	}

	var user User
	if err := db.First(&user, claims.UserID).Error; err != nil {
		errorResponse(c, http.StatusUnauthorized, "用户不存在")
		return
	}
	if user.Role != "user" {
		errorResponse(c, http.StatusBadRequest, "当前账号无需申请组织")
		return
	}
	if user.OrgStatus == "approved" && user.OrgID != nil {
		errorResponse(c, http.StatusBadRequest, "当前账号已绑定组织")
		return
	}

	pendingID := orgID
	if err := db.Model(&user).Updates(map[string]interface{}{
		"pending_org_id": &pendingID,
		"org_status":     "pending",
	}).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "申请失败")
		return
	}
	successResponse(c, gin.H{
		"message":        "已提交申请，等待组织审核",
		"pending_org_id": orgID,
		"org_status":     "pending",
	})
}

// ListOrganizationMembers 处理相关逻辑
func ListOrganizationMembers(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	orgID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的组织 id")
		return
	}
	orgID := uint(orgID64)

	var me User
	if err := db.First(&me, claims.UserID).Error; err != nil {
		errorResponse(c, http.StatusUnauthorized, "用户不存在")
		return
	}
	if me.OrgID == nil || *me.OrgID != orgID || me.OrgStatus != "approved" {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	var org Organization
	if err := db.First(&org, orgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "组织不存在")
		return
	}

	var users []User
	if err := db.Where("org_id = ? AND org_status = ?", orgID, "approved").Order("id asc").Find(&users).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询成员失败")
		return
	}
	list := make([]gin.H, 0, len(users))
	for _, u := range users {
		list = append(list, gin.H{
			"id":         u.ID,
			"username":   u.Username,
			"role":       u.Role,
			"is_owner":   u.ID == org.OwnerUserID,
			"org_status": u.OrgStatus,
		})
	}
	successResponse(c, gin.H{
		"org": gin.H{
			"id":            org.ID,
			"name":          org.Name,
			"owner_user_id": org.OwnerUserID,
		},
		"members": list,
	})
}

// RemoveOrganizationMember 处理相关逻辑
func RemoveOrganizationMember(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	orgID64, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的组织 id")
		return
	}
	orgID := uint(orgID64)
	userID64, err := strconv.ParseUint(c.Param("userId"), 10, 64)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的用户 id")
		return
	}
	userID := uint(userID64)

	if claims.Role != "org_owner" || claims.OrgID == nil || *claims.OrgID != orgID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}
	var org Organization
	if err := db.First(&org, orgID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "组织不存在")
		return
	}
	if org.OwnerUserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}
	if userID == org.OwnerUserID {
		errorResponse(c, http.StatusBadRequest, "不能移出组织创建者")
		return
	}

	var user User
	if err := db.First(&user, userID).Error; err != nil {
		errorResponse(c, http.StatusBadRequest, "用户不存在")
		return
	}
	if user.OrgID == nil || *user.OrgID != orgID || user.OrgStatus != "approved" {
		errorResponse(c, http.StatusBadRequest, "该用户不在组织中")
		return
	}

	if err := db.Model(&user).Updates(map[string]interface{}{
		"org_id":         nil,
		"pending_org_id": nil,
		"org_status":     "none",
	}).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "移出失败")
		return
	}
	successResponse(c, gin.H{"message": "已移出"})
}

// 创建签到记录 (已移除旧的 PostSignIn)
// func PostSignIn(db *gorm.DB, c *gin.Context) { ... }

// 创建场地
func PostRoom(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织，无法创建房间")
		return
	}
	// 转为 int 指针
	orgIDInt := int(*claims.OrgID)

	var roomReq RoomRequest
	if err := c.ShouldBindJSON(&roomReq); err != nil {
		log.Printf("JSON绑定错误: %v", err)
		errorResponse(c, http.StatusBadRequest, "无效的请求数据格式")
		return
	}

	// 处理seat_pos字段，将其序列化为JSON字符串
	var seatPosJSON string
	if roomReq.Seat_pos != nil {
		seatPosBytes, err := json.Marshal(roomReq.Seat_pos)
		if err != nil {
			log.Printf("序列化seat_pos失败: %v", err)
			errorResponse(c, http.StatusBadRequest, "座位数据格式无效")
			return
		}
		seatPosJSON = string(seatPosBytes)
	}

	// 创建数据库模型
	room := Room{
		Org_id:     &orgIDInt, // 强制使用当前用户的组织ID
		Room_id:    roomReq.Room_id,
		Seat_pos:   seatPosJSON, // 存储序列化后的JSON字符串
		Bssid_list: roomReq.Bssid_list,
	}

	// 使用 Upsert 功能：如果存在相同的 Room_id AND Org_id，则更新；否则创建
	var existingRoom Room
	result := db.Where("room_id = ? AND org_id = ?", roomReq.Room_id, orgIDInt).First(&existingRoom)

	isUpdate := false
	if result.Error == nil {
		// 找到现有记录，执行更新操作
		isUpdate = true
		// 保留原有的 ID
		room.ID = existingRoom.ID
		result = db.Save(&room)
	} else if result.Error == gorm.ErrRecordNotFound {
		// 没有找到记录，执行创建操作
		result = db.Create(&room)
	}

	if result.Error != nil {
		log.Printf("保存房间失败: %v", result.Error)
		errorResponse(c, http.StatusInternalServerError, "保存房间失败")
		return
	}

	// 根据操作类型设置响应消息
	message := "房间创建成功"
	if isUpdate {
		message = "房间更新成功"
	}

	// 返回成功响应
	responseData := gin.H{
		"message":    message,
		"id":         room.ID,
		"room_id":    room.Room_id,
		"bssid_list": room.Bssid_list,
		"org_id":     *room.Org_id,
	}

	// 返回原始的seat_pos数据格式
	responseData["seat_pos"] = roomReq.Seat_pos

	successResponse(c, responseData)
}

// GetAllRoomIDs 获取所有房间ID
func GetAllRoomIDs(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		// 未加入组织，返回空
		successResponse(c, gin.H{
			"room_ids": []string{},
			"total":    0,
		})
		return
	}

	var rooms []Room
	// 查询所有字段 (注意 Seat_pos 数据量可能较大，但列表展示一般不需要)
	// 为了前端下拉框显示，我们需要 ID 和 Room_id，以及可能的 Name (如果后续加了)
	// 这里直接返回基本信息，不返回 Seat_pos 以减少流量
	result := db.Select("id, room_id, org_id").Where("org_id = ?", *claims.OrgID).Find(&rooms)
	if result.Error != nil {
		log.Printf("查询所有房间ID失败: %v", result.Error)
		errorResponse(c, http.StatusInternalServerError, "查询房间列表失败")
		return
	}

	// 构建返回列表
	var roomList []gin.H
	for _, room := range rooms {
		roomList = append(roomList, gin.H{
			"id":      room.ID,
			"room_id": room.Room_id,
			"org_id":  room.Org_id,
		})
	}

	// 返回 room_id 列表
	responseData := gin.H{
		"rooms": roomList, // 修改为返回对象数组
		"total": len(roomList),
	}

	successResponse(c, responseData)
}

// DeleteRoom 删除房间
func DeleteRoom(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}

	roomID := c.Query("room_id")
	if roomID == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要参数: room_id")
		return
	}

	var room Room
	result := db.Where("room_id = ? AND org_id = ?", roomID, *claims.OrgID).First(&room)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			errorResponse(c, http.StatusNotFound, "未找到该房间信息")
		} else {
			log.Printf("查询房间失败: %v", result.Error)
			errorResponse(c, http.StatusInternalServerError, "查询房间失败")
		}
		return
	}

	if err := db.Delete(&room).Error; err != nil {
		log.Printf("删除房间失败: %v", err)
		errorResponse(c, http.StatusInternalServerError, "删除失败")
		return
	}

	successResponse(c, gin.H{"message": "房间删除成功"})
}

// sanitizeZipEntryName 处理相关逻辑
func sanitizeZipEntryName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "unknown"
	}
	s = filepath.Base(s)
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, s)
	if s == "" {
		return "unknown"
	}
	return s
}

// addLabelToPNG 处理相关逻辑
func addLabelToPNG(pngBytes []byte, label string) ([]byte, error) {
	srcImg, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, err
	}

	label = strings.TrimSpace(label)
	if label == "" {
		return pngBytes, nil
	}

	face := basicfont.Face7x13
	labelH := 24
	srcB := srcImg.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, srcB.Dx(), srcB.Dy()+labelH))

	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(dst, srcB, srcImg, srcB.Min, draw.Over)

	d := &font.Drawer{
		Dst:  dst,
		Src:  image.NewUniform(color.Black),
		Face: face,
	}

	textW := d.MeasureString(label).Ceil()
	startX := (srcB.Dx() - textW) / 2
	if startX < 0 {
		startX = 0
	}
	baselineY := srcB.Dy() + 4 + face.Ascent
	d.Dot = fixed.P(startX, baselineY)
	d.DrawString(label)

	out := new(bytes.Buffer)
	if err := png.Encode(out, dst); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// ExportRoomSeatQRCodesZip 处理相关逻辑
func ExportRoomSeatQRCodesZip(db *gorm.DB, c *gin.Context) {
	roomID := c.Query("room_id")
	if strings.TrimSpace(roomID) == "" {
		errorResponse(c, http.StatusBadRequest, "缺少必要参数: room_id")
		return
	}
	roomID = filepath.Base(roomID)

	ttl := strings.TrimSpace(c.Query("ttl"))
	ver := strings.TrimSpace(c.Query("ver"))

	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}

	var room Room
	result := db.Where("room_id = ? AND org_id = ?", roomID, *claims.OrgID).First(&room)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			errorResponse(c, http.StatusNotFound, "未找到该房间信息")
		} else {
			log.Printf("查询房间失败: %v", result.Error)
			errorResponse(c, http.StatusInternalServerError, "查询房间失败")
		}
		return
	}

	var seatPosObj map[string]interface{}
	if err := json.Unmarshal([]byte(room.Seat_pos), &seatPosObj); err != nil {
		log.Printf("反序列化seat_pos失败: %v", err)
		errorResponse(c, http.StatusInternalServerError, "座位数据解析失败")
		return
	}

	rawSeats, ok := seatPosObj["seats"].([]interface{})
	if !ok || len(rawSeats) == 0 {
		errorResponse(c, http.StatusBadRequest, "该房间没有座位数据")
		return
	}

	var labels []string
	for _, raw := range rawSeats {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		seatNumber, _ := m["seatNumber"].(string)
		if strings.TrimSpace(seatNumber) == "" {
			seatNumber, _ = m["label"].(string)
		}
		seatNumber = strings.TrimSpace(seatNumber)
		if seatNumber != "" {
			labels = append(labels, seatNumber)
		}
	}
	if len(labels) == 0 {
		errorResponse(c, http.StatusBadRequest, "该房间没有可用的座位编号")
		return
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	for _, seatLabel := range labels {
		qr := QRcode{
			Ver:  ver,
			Seat: seatLabel,
			Room: room.Room_id,
			Ttl:  ttl,
		}
		pngB64, err := generateQRcode(qr)
		if err != nil {
			zw.Close()
			errorResponse(c, http.StatusInternalServerError, "生成二维码失败")
			return
		}
		pngBytes, err := base64.StdEncoding.DecodeString(pngB64)
		if err != nil {
			zw.Close()
			errorResponse(c, http.StatusInternalServerError, "二维码数据编码失败")
			return
		}

		labeled, err := addLabelToPNG(pngBytes, room.Room_id+" "+seatLabel)
		if err != nil {
			zw.Close()
			errorResponse(c, http.StatusInternalServerError, "二维码渲染失败")
			return
		}

		entryName := sanitizeZipEntryName(seatLabel) + ".png"
		w, err := zw.Create(entryName)
		if err != nil {
			zw.Close()
			errorResponse(c, http.StatusInternalServerError, "创建压缩包失败")
			return
		}
		if _, err := w.Write(labeled); err != nil {
			zw.Close()
			errorResponse(c, http.StatusInternalServerError, "写入压缩包失败")
			return
		}
	}

	if err := zw.Close(); err != nil {
		errorResponse(c, http.StatusInternalServerError, "生成压缩包失败")
		return
	}

	filename := fmt.Sprintf("room_%s_qrcodes.zip", sanitizeZipEntryName(room.Room_id))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Data(http.StatusOK, "application/zip", buf.Bytes())
}

// --- Course CRUD Endpoints ---

// CreateCourse 处理相关逻辑
func CreateCourse(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	var req struct {
		Name             string      `json:"name"`
		Location         string      `json:"location"`
		DayIndex         int         `json:"dayIndex"`
		StartSlotIndex   int         `json:"startSlotIndex"`
		EndSlotIndex     int         `json:"endSlotIndex"`
		Color            string      `json:"color"`
		MemberMode       string      `json:"memberMode"`
		ClassRosterID    string      `json:"classRosterId"`
		SemesterID       uint        `json:"semester_id"`
		Members          interface{} `json:"members"`
		Weeks            interface{} `json:"weeks"` // 接收周次数组
		StartWeek        int         `json:"start_week"`
		EndWeek          int         `json:"end_week"`
		BSSIDEnabled     bool        `json:"bssid_enabled"`
		BSSIDList        string      `json:"bssid_list"`
		GPSEnabled       bool        `json:"gps_enabled"`
		GPSLat           float64     `json:"gps_lat"`
		GPSLng           float64     `json:"gps_lng"`
		GPSRadiusM       int         `json:"gps_radius_m"`
		IPEnabled        bool        `json:"ip_enabled"`
		IPList           string      `json:"ip_list"`
		FixedSeatEnabled bool        `json:"fixed_seat_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	normalizedBSSIDList := normalizeBSSIDList(req.BSSIDList)
	if req.BSSIDEnabled || strings.TrimSpace(normalizedBSSIDList) != "" {
		if claims.Role != "org_owner" {
			errorResponse(c, http.StatusForbidden, "无权限配置BSSID校验")
			return
		}
	}
	if req.BSSIDEnabled && strings.TrimSpace(normalizedBSSIDList) == "" {
		errorResponse(c, http.StatusBadRequest, "开启BSSID校验时必须填写BSSID列表")
		return
	}

	if req.GPSEnabled {
		if req.GPSRadiusM <= 0 || req.GPSLat == 0 || req.GPSLng == 0 {
			errorResponse(c, http.StatusBadRequest, "开启GPS校验时必须设置地点与半径")
			return
		}
	}
	normalizedIPList := normalizeIPList(req.IPList)
	if req.IPEnabled && strings.TrimSpace(normalizedIPList) == "" {
		errorResponse(c, http.StatusBadRequest, "开启出口IP校验时必须填写允许的IP段（CIDR）")
		return
	}
	if req.FixedSeatEnabled {
		if strings.TrimSpace(req.Location) == "" {
			errorResponse(c, http.StatusBadRequest, "开启固定座位时必须选择教室")
			return
		}
		if strings.TrimSpace(req.MemberMode) == "all" {
			errorResponse(c, http.StatusBadRequest, "开放模式不支持固定座位")
			return
		}
	}

	membersBytes, _ := json.Marshal(req.Members)
	weeksBytes, _ := json.Marshal(req.Weeks)

	course := Course{
		UserID:           claims.UserID,
		SemesterID:       req.SemesterID,
		Name:             req.Name,
		Location:         req.Location,
		DayIndex:         req.DayIndex,
		StartSlotIndex:   req.StartSlotIndex,
		EndSlotIndex:     req.EndSlotIndex,
		Color:            req.Color,
		MemberMode:       req.MemberMode,
		ClassRosterID:    req.ClassRosterID,
		Members:          string(membersBytes),
		Weeks:            string(weeksBytes),
		StartWeek:        req.StartWeek,
		EndWeek:          req.EndWeek,
		BSSIDEnabled:     req.BSSIDEnabled,
		BSSIDList:        normalizedBSSIDList,
		GPSEnabled:       req.GPSEnabled,
		GPSLat:           req.GPSLat,
		GPSLng:           req.GPSLng,
		GPSRadiusM:       req.GPSRadiusM,
		IPEnabled:        req.IPEnabled,
		IPList:           normalizedIPList,
		FixedSeatEnabled: req.FixedSeatEnabled,
	}

	if err := db.Create(&course).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "创建课程失败")
		return
	}

	// 回传 ID
	successResponse(c, gin.H{
		"id":      course.ID,
		"message": "课程创建成功",
	})
}

// UpdateCourse 处理相关逻辑
func UpdateCourse(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	idStr := c.Param("id")

	var req struct {
		Name             string      `json:"name"`
		Location         string      `json:"location"`
		DayIndex         int         `json:"dayIndex"`
		StartSlotIndex   int         `json:"startSlotIndex"`
		EndSlotIndex     int         `json:"endSlotIndex"`
		Color            string      `json:"color"`
		MemberMode       string      `json:"memberMode"`
		ClassRosterID    string      `json:"classRosterId"`
		Members          interface{} `json:"members"`
		SemesterID       uint        `json:"semester_id"`
		Weeks            interface{} `json:"weeks"`
		StartWeek        int         `json:"start_week"`
		EndWeek          int         `json:"end_week"`
		BSSIDEnabled     bool        `json:"bssid_enabled"`
		BSSIDList        string      `json:"bssid_list"`
		GPSEnabled       bool        `json:"gps_enabled"`
		GPSLat           float64     `json:"gps_lat"`
		GPSLng           float64     `json:"gps_lng"`
		GPSRadiusM       int         `json:"gps_radius_m"`
		IPEnabled        bool        `json:"ip_enabled"`
		IPList           string      `json:"ip_list"`
		FixedSeatEnabled bool        `json:"fixed_seat_enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	var course Course
	if err := db.First(&course, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}

	// 鉴权：只能修改自己的课程
	if course.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限修改此课程")
		return
	}

	normalizedBSSIDList := normalizeBSSIDList(req.BSSIDList)
	if req.BSSIDEnabled || strings.TrimSpace(normalizedBSSIDList) != "" {
		if claims.Role != "org_owner" {
			errorResponse(c, http.StatusForbidden, "无权限配置BSSID校验")
			return
		}
	}
	if req.BSSIDEnabled && strings.TrimSpace(normalizedBSSIDList) == "" {
		errorResponse(c, http.StatusBadRequest, "开启BSSID校验时必须填写BSSID列表")
		return
	}

	if req.GPSEnabled {
		if req.GPSRadiusM <= 0 || req.GPSLat == 0 || req.GPSLng == 0 {
			errorResponse(c, http.StatusBadRequest, "开启GPS校验时必须设置地点与半径")
			return
		}
	}
	normalizedIPList := normalizeIPList(req.IPList)
	if req.IPEnabled && strings.TrimSpace(normalizedIPList) == "" {
		errorResponse(c, http.StatusBadRequest, "开启出口IP校验时必须填写允许的IP段（CIDR）")
		return
	}
	if req.FixedSeatEnabled {
		if strings.TrimSpace(req.Location) == "" {
			errorResponse(c, http.StatusBadRequest, "开启固定座位时必须选择教室")
			return
		}
		if strings.TrimSpace(req.MemberMode) == "all" {
			errorResponse(c, http.StatusBadRequest, "开放模式不支持固定座位")
			return
		}
	}

	membersBytes, _ := json.Marshal(req.Members)
	weeksBytes, _ := json.Marshal(req.Weeks)

	course.Name = req.Name
	course.Location = req.Location
	course.DayIndex = req.DayIndex
	course.StartSlotIndex = req.StartSlotIndex
	course.EndSlotIndex = req.EndSlotIndex
	course.Color = req.Color
	course.MemberMode = req.MemberMode
	course.ClassRosterID = req.ClassRosterID
	course.Members = string(membersBytes)
	if req.SemesterID > 0 {
		course.SemesterID = req.SemesterID
	}
	course.Weeks = string(weeksBytes)
	course.StartWeek = req.StartWeek
	course.EndWeek = req.EndWeek
	course.BSSIDEnabled = req.BSSIDEnabled
	if req.BSSIDEnabled {
		course.BSSIDList = normalizedBSSIDList
	} else {
		course.BSSIDList = ""
	}
	course.GPSEnabled = req.GPSEnabled
	if req.GPSEnabled {
		course.GPSLat = req.GPSLat
		course.GPSLng = req.GPSLng
		course.GPSRadiusM = req.GPSRadiusM
	} else {
		course.GPSLat = 0
		course.GPSLng = 0
		course.GPSRadiusM = 0
	}
	course.IPEnabled = req.IPEnabled
	if req.IPEnabled {
		course.IPList = normalizedIPList
	} else {
		course.IPList = ""
	}
	course.FixedSeatEnabled = req.FixedSeatEnabled

	if err := db.Save(&course).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "更新课程失败")
		return
	}

	successResponse(c, gin.H{"message": "更新成功"})
}

// DeleteCourse 处理相关逻辑
func DeleteCourse(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := c.Param("id")

	var course Course
	if err := db.First(&course, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}
	if course.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限删除此课程")
		return
	}

	db.Where("course_id = ?", course.ID).Delete(&CourseFixedSeat{})
	if err := db.Delete(&course).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "删除失败")
		return
	}
	successResponse(c, gin.H{"message": "删除成功"})
}

// GetCourseFixedSeats 处理相关逻辑
func GetCourseFixedSeats(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := c.Param("id")

	var course Course
	if err := db.First(&course, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}
	if course.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限查看此课程")
		return
	}

	var rows []CourseFixedSeat
	if err := db.Where("course_id = ?", course.ID).Find(&rows).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"student_id": r.StudentID,
			"seat_label": r.SeatLabel,
		})
	}
	successResponse(c, gin.H{"assignments": out})
}

// PutCourseFixedSeats 处理相关逻辑
func PutCourseFixedSeats(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := c.Param("id")

	var course Course
	if err := db.First(&course, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "课程不存在")
		return
	}
	if course.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限修改此课程")
		return
	}

	var req struct {
		Assignments []struct {
			StudentID string `json:"student_id"`
			SeatLabel string `json:"seat_label"`
		} `json:"assignments"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	seenStudent := make(map[string]bool)
	seenSeat := make(map[string]bool)
	rows := make([]CourseFixedSeat, 0, len(req.Assignments))
	for _, a := range req.Assignments {
		sid := strings.TrimSpace(a.StudentID)
		seat := filepath.Base(strings.TrimSpace(a.SeatLabel))
		if sid == "" || seat == "" {
			continue
		}
		if seenStudent[sid] {
			errorResponse(c, http.StatusBadRequest, "学生座位分配存在重复学生")
			return
		}
		if seenSeat[seat] {
			errorResponse(c, http.StatusBadRequest, "学生座位分配存在重复座位")
			return
		}
		seenStudent[sid] = true
		seenSeat[seat] = true
		rows = append(rows, CourseFixedSeat{
			CourseID:  course.ID,
			StudentID: sid,
			SeatLabel: seat,
		})
	}

	tx := db.Begin()
	if err := tx.Where("course_id = ?", course.ID).Delete(&CourseFixedSeat{}).Error; err != nil {
		tx.Rollback()
		errorResponse(c, http.StatusInternalServerError, "保存失败")
		return
	}
	if len(rows) > 0 {
		if err := tx.CreateInBatches(rows, 200).Error; err != nil {
			tx.Rollback()
			if strings.Contains(err.Error(), "Duplicate entry") {
				errorResponse(c, http.StatusBadRequest, "学生座位分配存在冲突")
				return
			}
			errorResponse(c, http.StatusInternalServerError, "保存失败")
			return
		}
	}
	if err := tx.Commit().Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "保存失败")
		return
	}

	successResponse(c, gin.H{"message": "保存成功"})
}

// ListCourses 处理相关逻辑
func ListCourses(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	// 获取 semester_id 参数
	semesterIDStr := c.Query("semester_id")

	query := db.Where("user_id = ?", claims.UserID)
	if semesterIDStr != "" {
		semesterID, _ := strconv.Atoi(semesterIDStr)
		query = query.Where("semester_id = ?", semesterID)
	}

	var courses []Course
	if err := query.Find(&courses).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询课程失败")
		return
	}

	// 转换 Members 和 Weeks JSON 字符串回对象
	result := make([]gin.H, 0, len(courses))
	for _, c := range courses {
		var members interface{}
		if c.Members != "" {
			json.Unmarshal([]byte(c.Members), &members)
		} else {
			members = []interface{}{}
		}

		var weeks interface{}
		if c.Weeks != "" {
			json.Unmarshal([]byte(c.Weeks), &weeks)
		} else {
			weeks = []interface{}{}
		}

		result = append(result, gin.H{
			"id":                 c.ID,
			"semester_id":        c.SemesterID,
			"name":               c.Name,
			"location":           c.Location,
			"dayIndex":           c.DayIndex,
			"startSlotIndex":     c.StartSlotIndex,
			"endSlotIndex":       c.EndSlotIndex,
			"color":              c.Color,
			"memberMode":         c.MemberMode,
			"classRosterId":      c.ClassRosterID,
			"members":            members,
			"weeks":              weeks,
			"start_week":         c.StartWeek,
			"end_week":           c.EndWeek,
			"bssid_enabled":      c.BSSIDEnabled,
			"bssid_list":         c.BSSIDList,
			"gps_enabled":        c.GPSEnabled,
			"gps_lat":            c.GPSLat,
			"gps_lng":            c.GPSLng,
			"gps_radius_m":       c.GPSRadiusM,
			"ip_enabled":         c.IPEnabled,
			"ip_list":            c.IPList,
			"fixed_seat_enabled": c.FixedSeatEnabled,
		})
	}

	successResponse(c, gin.H{"courses": result})
}

// --- ClassRoster CRUD Endpoints ---

// CreateClassRoster 处理相关逻辑
func CreateClassRoster(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}

	var req struct {
		Name    string      `json:"name"`
		Members interface{} `json:"members"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	membersBytes, _ := json.Marshal(req.Members)

	roster := ClassRoster{
		OrgID:   *claims.OrgID,
		Name:    req.Name,
		Members: string(membersBytes),
	}

	if err := db.Create(&roster).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "创建班级名单失败")
		return
	}

	successResponse(c, gin.H{
		"id":      roster.ID,
		"message": "创建成功",
	})
}

// UpdateClassRoster 处理相关逻辑
func UpdateClassRoster(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}
	idStr := c.Param("id")

	var req struct {
		Name    string      `json:"name"`
		Members interface{} `json:"members"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	var roster ClassRoster
	if err := db.First(&roster, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "名单不存在")
		return
	}

	if roster.OrgID != *claims.OrgID {
		errorResponse(c, http.StatusForbidden, "无权限修改其他组织的名单")
		return
	}

	membersBytes, _ := json.Marshal(req.Members)
	roster.Name = req.Name
	roster.Members = string(membersBytes)

	if err := db.Save(&roster).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "更新失败")
		return
	}
	successResponse(c, gin.H{"message": "更新成功"})
}

// DeleteClassRoster 处理相关逻辑
func DeleteClassRoster(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		errorResponse(c, http.StatusForbidden, "未加入组织")
		return
	}
	idStr := c.Param("id")

	var roster ClassRoster
	if err := db.First(&roster, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "名单不存在")
		return
	}

	if roster.OrgID != *claims.OrgID {
		errorResponse(c, http.StatusForbidden, "无权限删除其他组织的名单")
		return
	}

	if err := db.Delete(&roster).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "删除失败")
		return
	}
	successResponse(c, gin.H{"message": "删除成功"})
}

// ListClassRosters 处理相关逻辑
func ListClassRosters(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	if claims.OrgID == nil {
		// 未加入组织，返回空列表
		successResponse(c, gin.H{"rosters": []interface{}{}})
		return
	}

	var rosters []ClassRoster
	if err := db.Where("org_id = ?", *claims.OrgID).Find(&rosters).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	result := make([]gin.H, 0, len(rosters))
	for _, r := range rosters {
		var members interface{}
		if r.Members != "" {
			json.Unmarshal([]byte(r.Members), &members)
		} else {
			members = []interface{}{}
		}

		result = append(result, gin.H{
			"id":      r.ID,
			"name":    r.Name,
			"members": members,
		})
	}

	successResponse(c, gin.H{"rosters": result})
}

// --- Semester CRUD Endpoints ---

// CreateSemester 处理相关逻辑
func CreateSemester(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	var req struct {
		Name      string      `json:"name"`
		StartDate string      `json:"start_date"` // YYYY-MM-DD
		EndDate   string      `json:"end_date"`   // YYYY-MM-DD
		TimeSlots interface{} `json:"time_slots"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		errorResponse(c, http.StatusBadRequest, "学期名称不能为空")
		return
	}

	// 解析日期
	var startTime, endTime time.Time
	var err error
	const layout = "2006-01-02"

	if req.StartDate != "" {
		startTime, err = time.Parse(layout, req.StartDate)
		if err != nil {
			errorResponse(c, http.StatusBadRequest, "开始日期格式错误，应为 YYYY-MM-DD")
			return
		}
		if startTime.Weekday() != time.Monday {
			errorResponse(c, http.StatusBadRequest, "开始日期必须是周一")
			return
		}
	}

	if req.EndDate != "" {
		endTime, err = time.Parse(layout, req.EndDate)
		if err != nil {
			errorResponse(c, http.StatusBadRequest, "结束日期格式错误，应为 YYYY-MM-DD")
			return
		}
		if endTime.Weekday() != time.Sunday {
			errorResponse(c, http.StatusBadRequest, "结束日期必须是周日")
			return
		}
	}

	if !startTime.IsZero() && !endTime.IsZero() && endTime.Before(startTime) {
		errorResponse(c, http.StatusBadRequest, "结束日期不能早于开始日期")
		return
	}

	if !startTime.IsZero() && !endTime.IsZero() {
		var existing []Semester
		if err := db.Where("user_id = ?", claims.UserID).Find(&existing).Error; err == nil {
			for _, s := range existing {
				if s.StartDate.IsZero() || s.EndDate.IsZero() {
					continue
				}
				if !endTime.Before(s.StartDate) && !s.EndDate.Before(startTime) {
					errorResponse(c, http.StatusBadRequest, fmt.Sprintf("学期时间与已有学期「%s」重合", s.Name))
					return
				}
			}
		}
	}

	semester := Semester{
		UserID:    claims.UserID,
		Name:      req.Name,
		StartDate: startTime,
		EndDate:   endTime,
	}
	if req.TimeSlots != nil {
		if b, err := json.Marshal(req.TimeSlots); err == nil {
			semester.TimeSlots = string(b)
		}
	}

	if err := db.Create(&semester).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "创建学期失败")
		return
	}

	successResponse(c, gin.H{
		"id":      semester.ID,
		"message": "创建成功",
	})
}

// ListSemesters 处理相关逻辑
func ListSemesters(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)

	var semesters []Semester
	if err := db.Where("user_id = ?", claims.UserID).Order("id desc").Find(&semesters).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "查询失败")
		return
	}

	// 如果没有学期，检查是否有遗留课程 (semester_id=0)
	if len(semesters) == 0 {
		var count int64
		db.Model(&Course{}).Where("user_id = ? AND semester_id = 0", claims.UserID).Count(&count)
		if count > 0 {
			// 自动创建一个默认学期，并将旧课程迁移过去
			defaultSemester := Semester{
				UserID: claims.UserID,
				Name:   "默认学期",
			}
			if err := db.Create(&defaultSemester).Error; err == nil {
				// 迁移旧课程
				db.Model(&Course{}).Where("user_id = ? AND semester_id = 0", claims.UserID).Update("semester_id", defaultSemester.ID)
				semesters = append(semesters, defaultSemester)
			}
		}
	}

	successResponse(c, gin.H{"semesters": semesters})
}

// UpdateSemester 处理相关逻辑
func UpdateSemester(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := c.Param("id")

	var req struct {
		Name      string      `json:"name"`
		StartDate string      `json:"start_date"` // YYYY-MM-DD
		EndDate   string      `json:"end_date"`   // YYYY-MM-DD
		TimeSlots interface{} `json:"time_slots"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, "无效的请求数据")
		return
	}

	var semester Semester
	if err := db.First(&semester, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "学期不存在")
		return
	}
	if semester.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	// 解析日期
	var startTime, endTime time.Time
	var err error
	const layout = "2006-01-02"

	if req.StartDate != "" {
		startTime, err = time.Parse(layout, req.StartDate)
		if err != nil {
			errorResponse(c, http.StatusBadRequest, "开始日期格式错误，应为 YYYY-MM-DD")
			return
		}
		if startTime.Weekday() != time.Monday {
			errorResponse(c, http.StatusBadRequest, "开始日期必须是周一")
			return
		}
	}

	if req.EndDate != "" {
		endTime, err = time.Parse(layout, req.EndDate)
		if err != nil {
			errorResponse(c, http.StatusBadRequest, "结束日期格式错误，应为 YYYY-MM-DD")
			return
		}
		if endTime.Weekday() != time.Sunday {
			errorResponse(c, http.StatusBadRequest, "结束日期必须是周日")
			return
		}
	}

	if !startTime.IsZero() && !endTime.IsZero() && endTime.Before(startTime) {
		errorResponse(c, http.StatusBadRequest, "结束日期不能早于开始日期")
		return
	}

	nextStart := semester.StartDate
	nextEnd := semester.EndDate
	if !startTime.IsZero() {
		nextStart = startTime
	}
	if !endTime.IsZero() {
		nextEnd = endTime
	}
	if !nextStart.IsZero() && !nextEnd.IsZero() {
		var existing []Semester
		if err := db.Where("user_id = ?", claims.UserID).Find(&existing).Error; err == nil {
			for _, s := range existing {
				if s.ID == semester.ID {
					continue
				}
				if s.StartDate.IsZero() || s.EndDate.IsZero() {
					continue
				}
				if !nextEnd.Before(s.StartDate) && !s.EndDate.Before(nextStart) {
					errorResponse(c, http.StatusBadRequest, fmt.Sprintf("学期时间与已有学期「%s」重合", s.Name))
					return
				}
			}
		}
	}

	semester.Name = req.Name
	if !startTime.IsZero() {
		semester.StartDate = startTime
	}
	if !endTime.IsZero() {
		semester.EndDate = endTime
	}
	if req.TimeSlots != nil {
		if b, err := json.Marshal(req.TimeSlots); err == nil {
			semester.TimeSlots = string(b)
		}
	}

	if err := db.Save(&semester).Error; err != nil {
		errorResponse(c, http.StatusInternalServerError, "更新失败")
		return
	}
	successResponse(c, gin.H{"message": "更新成功"})
}

// DeleteSemester 处理相关逻辑
func DeleteSemester(db *gorm.DB, c *gin.Context) {
	v, ok := c.Get("authClaims")
	if !ok {
		errorResponse(c, http.StatusUnauthorized, "未登录")
		return
	}
	claims := v.(AuthClaims)
	idStr := c.Param("id")

	var semester Semester
	if err := db.First(&semester, idStr).Error; err != nil {
		errorResponse(c, http.StatusNotFound, "学期不存在")
		return
	}
	if semester.UserID != claims.UserID {
		errorResponse(c, http.StatusForbidden, "无权限")
		return
	}

	// 级联删除该学期下的所有课程
	tx := db.Begin()
	if err := tx.Where("semester_id = ?", semester.ID).Delete(&Course{}).Error; err != nil {
		tx.Rollback()
		errorResponse(c, http.StatusInternalServerError, "删除关联课程失败")
		return
	}
	if err := tx.Delete(&semester).Error; err != nil {
		tx.Rollback()
		errorResponse(c, http.StatusInternalServerError, "删除学期失败")
		return
	}
	tx.Commit()

	successResponse(c, gin.H{"message": "删除成功"})
}

// --- HMAC 工具函数 ---
// 计算 HMAC-SHA256 的 Base64 URL 安全字符串
func HmacSha256ToBase64(key string, data string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(data))
	return base64.URLEncoding.EncodeToString(mac.Sum(nil))
}

// --- 工具函数 ---
func successResponse(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Code:    0,
		Message: "success",
		Data:    data,
	})
}

// errorResponse 处理相关逻辑
func errorResponse(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, Response{
		Code:    -1,
		Message: message,
		Data:    nil,
	})
}

// GeoIPByIP 处理相关逻辑
func GeoIPByIP(c *gin.Context) {
	rawIP := strings.TrimSpace(c.ClientIP())
	if rawIP == "" {
		errorResponse(c, http.StatusBadRequest, "无法获取客户端IP")
		return
	}

	parsed := net.ParseIP(rawIP)
	isBadIP := parsed == nil || parsed.IsUnspecified() || parsed.IsLoopback() || parsed.IsPrivate()

	var urlStr string
	if isBadIP {
		urlStr = "https://ipapi.co/json/"
	} else {
		urlStr = fmt.Sprintf("https://ipapi.co/%s/json/", rawIP)
	}

	client := &http.Client{Timeout: 2 * time.Second}
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, "创建GeoIP请求失败")
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "sign-in-system/geoip")

	res, err := client.Do(req)
	if err != nil {
		errorResponse(c, http.StatusBadGateway, "GeoIP服务请求失败")
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		errorResponse(c, http.StatusBadGateway, "GeoIP服务不可用")
		return
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		errorResponse(c, http.StatusBadGateway, "读取GeoIP响应失败")
		return
	}

	var data struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		City      string  `json:"city"`
		Region    string  `json:"region"`
		Country   string  `json:"country_name"`
		Error     bool    `json:"error"`
		Reason    string  `json:"reason"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		errorResponse(c, http.StatusBadGateway, "解析GeoIP响应失败")
		return
	}
	if data.Error {
		msg := strings.TrimSpace(data.Reason)
		if msg == "" {
			msg = "GeoIP服务返回错误"
		}
		errorResponse(c, http.StatusBadGateway, msg)
		return
	}
	if data.Latitude == 0 || data.Longitude == 0 {
		errorResponse(c, http.StatusNotFound, "未能从IP解析到位置")
		return
	}

	successResponse(c, gin.H{
		"ip":       rawIP,
		"lat":      data.Latitude,
		"lng":      data.Longitude,
		"source":   "ip",
		"provider": "ipapi.co",
		"city":     data.City,
		"region":   data.Region,
		"country":  data.Country,
	})
}

// safeBase 处理相关逻辑
func safeBase(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	return filepath.Base(s)
}

// --- 核心逻辑 ---
func generateQRcode(qr QRcode) (string, error) {
	//TTL 解析
	var duration time.Duration
	if qr.Ttl == "" {
		duration = 5 * time.Minute
	} else if strings.ContainsAny(qr.Ttl, "smhd") {
		if d, err := time.ParseDuration(qr.Ttl); err == nil {
			duration = d
		} else {
			duration = 5 * time.Minute
		}
	} else if i, err := strconv.Atoi(qr.Ttl); err == nil {
		duration = time.Duration(i) * time.Second
	} else {
		duration = 5 * time.Minute
	}

	//签发时间
	var iat time.Time
	if qr.Iat == "" {
		iat = time.Now()
	} else {
		t, err := time.Parse(time.RFC3339, qr.Iat)
		if err != nil {
			iat = time.Now()
		} else {
			iat = t
		}
	}

	//构建签名内容（不含签名字段）
	signContent := fmt.Sprintf("%s|%s|%s|%s|%s",
		qr.Room,
		qr.Seat,
		iat.Format(time.RFC3339),
		duration.String(),
		qr.Ver,
	)

	// 计算签名
	sig := HmacSha256ToBase64(SecretKey, signContent)

	//序列化成最终二维码数据结构
	qrData := struct {
		Ver  string `json:"ver"`
		Seat string `json:"seat"`
		Room string `json:"room"`
		Iat  string `json:"iat"`
		Ttl  string `json:"ttl"`
		Sig  string `json:"sig"`
	}{
		Ver:  qr.Ver,
		Seat: qr.Seat,
		Room: qr.Room,
		Iat:  iat.Format(time.RFC3339),
		Ttl:  duration.String(),
		Sig:  sig,
	}

	jsonData, err := json.Marshal(qrData)
	if err != nil {
		return "", err
	}

	//生成二维码图片
	pngBytes, err := qrcode.Encode(string(jsonData), qrcode.Medium, 256)
	if err != nil {
		return "", err
	}

	//Base64 输出
	return base64.StdEncoding.EncodeToString(pngBytes), nil
}

// verifyQRcode 处理相关逻辑
func verifyQRcode(qr QRcode) (bool, error) {
	var verifyStatus bool

	//TTL 解析
	var duration time.Duration
	if qr.Ttl == "" {
		duration = 5 * time.Minute
	} else if strings.ContainsAny(qr.Ttl, "smhd") {
		if d, err := time.ParseDuration(qr.Ttl); err == nil {
			duration = d
		} else {
			duration = 5 * time.Minute
		}
	} else if i, err := strconv.Atoi(qr.Ttl); err == nil {
		duration = time.Duration(i) * time.Second
	} else {
		duration = 5 * time.Minute
	}

	//签发时间
	var iat time.Time
	if qr.Iat == "" {
		iat = time.Now()
	} else {
		t, err := time.Parse(time.RFC3339, qr.Iat)
		if err != nil {
			iat = time.Now()
		} else {
			iat = t
		}
	}

	//构建签名内容（不含签名字段）
	signContent := fmt.Sprintf("%s|%s|%s|%s|%s",
		qr.Room,
		qr.Seat,
		iat.Format(time.RFC3339),
		duration.String(),
		qr.Ver,
	)

	// 计算签名
	sig := HmacSha256ToBase64(SecretKey, signContent)

	if sig == qr.Sig {
		verifyStatus = true
	} else {
		verifyStatus = false
		log.Printf("签名比对错误: expected=%s provided=%s", sig, qr.Sig)
		log.Printf("签名比对明细: room=%q seat=%q iat=%q ttl=%q ver=%q signContent=%q", qr.Room, qr.Seat, iat.Format(time.RFC3339), duration.String(), qr.Ver, signContent)
	}
	return verifyStatus, nil
}

// --- 主函数 ---
func main() {
	mustInitSecrets()
	db, err := connectDB()
	if err != nil {
		panic(err.Error())
	}
	initRedis()
	r := gin.Default()

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	tilesDir := strings.TrimSpace(os.Getenv("MAP_TILES_DIR"))
	if tilesDir == "" {
		tilesDir = "maptiles"
	}
	r.Static("/tiles", tilesDir)

	// 1. 配置 CORS 中间件
	r.Use(cors.New(cors.Config{
		// 允许的前端源（必须指定具体地址，开发环境用 localhost:5173）
		AllowOrigins: []string{"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"},
		// 允许的请求方法（默认已包含 OPTIONS 预检请求，无需额外添加）
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		// 允许的请求头（如 Content-Type、Authorization 等）
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		// 预检请求的缓存时间（减少 OPTIONS 重复请求，可选）
		MaxAge: 12 * time.Hour,
	}))

	r.POST("/auth/register", func(c *gin.Context) { Register(db, c) })
	r.POST("/auth/login", func(c *gin.Context) { Login(db, c) })
	r.GET("/orgs", func(c *gin.Context) { ListOrganizations(db, c) })

	auth := r.Group("/")
	auth.Use(authMiddleware())
	auth.GET("/me", func(c *gin.Context) { GetMe(db, c) })
	auth.GET("/geo/ip", func(c *gin.Context) { GeoIPByIP(c) })
	auth.GET("/orgs/:id/pending-users", func(c *gin.Context) { ListPendingUsers(db, c) })
	auth.POST("/orgs/:id/pending-users/:userId/approve", func(c *gin.Context) { ApprovePendingUser(db, c) })
	auth.POST("/orgs/:id/pending-users/:userId/reject", func(c *gin.Context) { RejectPendingUser(db, c) })
	auth.POST("/orgs/:id/apply", func(c *gin.Context) { ApplyToOrganization(db, c) })
	auth.GET("/orgs/:id/members", func(c *gin.Context) { ListOrganizationMembers(db, c) })
	auth.POST("/orgs/:id/members/:userId/remove", func(c *gin.Context) { RemoveOrganizationMember(db, c) })

	// Room endpoints (Authenticated & Scoped)
	auth.GET("/roomseat", func(c *gin.Context) { GetRoomByID(db, c) })
	auth.GET("/rooms", func(c *gin.Context) { GetAllRoomIDs(db, c) })
	auth.POST("/room", func(c *gin.Context) { PostRoom(db, c) })
	auth.GET("/room/qrcodes", func(c *gin.Context) { ExportRoomSeatQRCodesZip(db, c) })
	auth.DELETE("/room", func(c *gin.Context) { DeleteRoom(db, c) })

	// Course endpoints
	auth.GET("/courses", func(c *gin.Context) { ListCourses(db, c) })
	auth.POST("/courses", func(c *gin.Context) { CreateCourse(db, c) })
	auth.PUT("/courses/:id", func(c *gin.Context) { UpdateCourse(db, c) })
	auth.DELETE("/courses/:id", func(c *gin.Context) { DeleteCourse(db, c) })
	auth.GET("/courses/:id/fixed-seats", func(c *gin.Context) { GetCourseFixedSeats(db, c) })
	auth.PUT("/courses/:id/fixed-seats", func(c *gin.Context) { PutCourseFixedSeats(db, c) })

	// ClassRoster endpoints
	auth.GET("/rosters", func(c *gin.Context) { ListClassRosters(db, c) })
	auth.POST("/rosters", func(c *gin.Context) { CreateClassRoster(db, c) })
	auth.PUT("/rosters/:id", func(c *gin.Context) { UpdateClassRoster(db, c) })
	auth.DELETE("/rosters/:id", func(c *gin.Context) { DeleteClassRoster(db, c) })
	auth.GET("/members/template", func(c *gin.Context) { MembersTemplate(db, c) })
	auth.POST("/members/import", func(c *gin.Context) { MembersImport(db, c) })

	// Semester endpoints
	auth.GET("/semesters", func(c *gin.Context) { ListSemesters(db, c) })
	auth.POST("/semesters", func(c *gin.Context) { CreateSemester(db, c) })
	auth.PUT("/semesters/:id", func(c *gin.Context) { UpdateSemester(db, c) })
	auth.DELETE("/semesters/:id", func(c *gin.Context) { DeleteSemester(db, c) })

	// Sign Session endpoints
	auth.GET("/sessions", func(c *gin.Context) { ListSignSessions(db, c) })
	auth.POST("/sessions", func(c *gin.Context) { CreateSignSession(db, c) })
	auth.POST("/sessions/:id/end", func(c *gin.Context) { EndSignSession(db, c) })
	auth.GET("/sessions/active", func(c *gin.Context) { GetActiveSession(db, c) })
	auth.GET("/sessions/:id/signins", func(c *gin.Context) { GetSessionSignIns(db, c) })
	auth.DELETE("/sessions/:sessionId/signins/:signId", func(c *gin.Context) { DeleteSignIn(db, c) })
	auth.GET("/sessions/:id/alerts", func(c *gin.Context) { GetSessionAlerts(db, c) })
	auth.GET("/sessions/:id/leaves", func(c *gin.Context) { GetSessionLeaves(db, c) })
	auth.PUT("/sessions/:id/leaves", func(c *gin.Context) { PutSessionLeaves(db, c) })
	auth.POST("/sessions/:id/remind-absence", func(c *gin.Context) { RemindAbsence(db, c) })
	auth.GET("/ai/seat-heatmap", func(c *gin.Context) { AISeatHeatmap(db, c) })
	auth.GET("/ai/anomalies", func(c *gin.Context) { AIAnomalies(db, c) })
	auth.GET("/attendance/courses", func(c *gin.Context) { AttendanceListCourses(db, c) })
	auth.GET("/attendance/sessions", func(c *gin.Context) { AttendanceListSessions(db, c) })
	auth.GET("/attendance/sessions/export", func(c *gin.Context) { AttendanceExportSessions(db, c) })
	auth.GET("/attendance/sessions/:id/export", func(c *gin.Context) { AttendanceExportSession(db, c) })

	fmt.Println("All routes registered successfully!")

	// Public/Student endpoints
	r.POST("/wx/login", func(c *gin.Context) { WxLogin(db, c) })

	// POST接口：学生发起签到
	r.POST("/signin", wxAuthMiddleware(), func(c *gin.Context) { PostSignIn(db, c) })

	// GET接口：获取缺勤提醒
	r.GET("/absences/alerts", wxAuthMiddleware(), func(c *gin.Context) { GetAbsenceAlertsByOpenID(db, c) })

	// POST接口：生成二维码
	r.POST("/generateQRcode", func(c *gin.Context) {
		var qr QRcode
		if err := c.ShouldBindJSON(&qr); err != nil {
			log.Printf("JSON绑定错误: %v", err)
			errorResponse(c, http.StatusBadRequest, "无效的请求数据格式")
			return
		}

		if qr.Seat == "" || qr.Room == "" {
			errorResponse(c, http.StatusBadRequest, "缺少必要字段: seat 或 room")
			return
		}

		// 防止路径注入
		qr.Ver = filepath.Base(qr.Ver)
		qr.Room = filepath.Base(qr.Room)
		qr.Seat = filepath.Base(qr.Seat)
		qr.Iat = filepath.Base(qr.Iat)
		qr.Ttl = filepath.Base(qr.Ttl)

		base64QR, err := generateQRcode(qr)
		if err != nil {
			log.Printf("生成二维码失败: %v", err)
			errorResponse(c, http.StatusInternalServerError, "生成二维码失败")
			return
		}

		successResponse(c, gin.H{
			"qrcode_base64": base64QR,
		})
	})

	// POST接口：校验二维码
	r.POST("/verifyQRcode", func(c *gin.Context) {
		var qr QRcode
		if err := c.ShouldBindJSON(&qr); err != nil {
			log.Printf("JSON绑定错误: %v", err)
			errorResponse(c, http.StatusBadRequest, "无效的请求数据格式")
			return
		}
		// 防止路径注入
		qr.Ver = filepath.Base(qr.Ver)
		qr.Room = filepath.Base(qr.Room)
		qr.Seat = filepath.Base(qr.Seat)
		qr.Iat = filepath.Base(qr.Iat)
		qr.Ttl = filepath.Base(qr.Ttl)

		verifyStatus, err := verifyQRcode(qr)
		if err != nil {
			log.Printf("验证二维码失败: %v", err)
			errorResponse(c, http.StatusInternalServerError, "验证二维码失败")
			return
		}

		successResponse(c, gin.H{
			"verifyStatus": verifyStatus,
		})
	})

	r.Run(":8080")
}
