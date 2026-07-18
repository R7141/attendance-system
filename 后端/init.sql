-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: localhost    Database: sign_in_system
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `sign_in_system`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `sign_in_system` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `sign_in_system`;

--
-- Table structure for table `class_rosters`
--

DROP TABLE IF EXISTS `class_rosters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `class_rosters` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `org_id` bigint unsigned NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `members` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  KEY `idx_class_rosters_org_id` (`org_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `class_rosters`
--

LOCK TABLES `class_rosters` WRITE;
/*!40000 ALTER TABLE `class_rosters` DISABLE KEYS */;
INSERT INTO `class_rosters` VALUES (1,1,'2026','[{\"name\":\"Q\",\"studentId\":\"001\"},{\"name\":\"w\",\"studentId\":\"002\"}]');
/*!40000 ALTER TABLE `class_rosters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `course_fixed_seats`
--

DROP TABLE IF EXISTS `course_fixed_seats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_fixed_seats` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `course_id` bigint unsigned NOT NULL,
  `student_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `seat_label` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_course_student` (`course_id`,`student_id`),
  UNIQUE KEY `uniq_course_seat` (`course_id`,`seat_label`),
  KEY `idx_course_fixed_seats_course_id` (`course_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `course_fixed_seats`
--

LOCK TABLES `course_fixed_seats` WRITE;
/*!40000 ALTER TABLE `course_fixed_seats` DISABLE KEYS */;
INSERT INTO `course_fixed_seats` VALUES (3,4,'001','A1','2026-06-02 23:06:26.400','2026-06-02 23:06:26.400');
/*!40000 ALTER TABLE `course_fixed_seats` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `courses`
--

DROP TABLE IF EXISTS `courses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `semester_id` bigint unsigned DEFAULT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location` longtext COLLATE utf8mb4_unicode_ci,
  `day_index` bigint DEFAULT NULL,
  `start_slot_index` bigint DEFAULT NULL,
  `end_slot_index` bigint DEFAULT NULL,
  `color` longtext COLLATE utf8mb4_unicode_ci,
  `member_mode` longtext COLLATE utf8mb4_unicode_ci,
  `class_roster_id` longtext COLLATE utf8mb4_unicode_ci,
  `members` longtext COLLATE utf8mb4_unicode_ci,
  `weeks` longtext COLLATE utf8mb4_unicode_ci,
  `start_week` bigint DEFAULT NULL,
  `end_week` bigint DEFAULT NULL,
  `bss_id_enabled` tinyint(1) DEFAULT NULL,
  `bss_id_list` longtext COLLATE utf8mb4_unicode_ci,
  `gps_enabled` tinyint(1) DEFAULT NULL,
  `gps_lat` double DEFAULT NULL,
  `gps_lng` double DEFAULT NULL,
  `gps_radius_m` bigint DEFAULT NULL,
  `ip_enabled` tinyint(1) DEFAULT NULL,
  `ip_list` longtext COLLATE utf8mb4_unicode_ci,
  `fixed_seat_enabled` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_courses_user_id` (`user_id`),
  KEY `idx_courses_semester_id` (`semester_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `courses`
--

LOCK TABLES `courses` WRITE;
/*!40000 ALTER TABLE `courses` DISABLE KEYS */;
INSERT INTO `courses` VALUES (2,1,2,'计算机','',0,0,0,'#9b59b6','independent','','[{\"name\":\"Q\",\"studentId\":\"001\"}]','[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]',1,20,0,'',1,22.911633623396455,113.87071496838729,50,0,'',0),(4,2,3,'1','801',1,7,7,'#2ecc71','class','1','[]','[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]',1,19,0,'',1,22.911635128837005,113.87073344401212,1000,0,'',1);
/*!40000 ALTER TABLE `courses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `organizations`
--

DROP TABLE IF EXISTS `organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `organizations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_user_id` bigint unsigned NOT NULL,
  `created_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `organizations`
--

LOCK TABLES `organizations` WRITE;
/*!40000 ALTER TABLE `organizations` DISABLE KEYS */;
INSERT INTO `organizations` VALUES (1,'dgut',2,'2026-06-02 22:58:44.075');
/*!40000 ALTER TABLE `organizations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `rooms`
--

DROP TABLE IF EXISTS `rooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rooms` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `org_id` bigint DEFAULT NULL,
  `room_id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `seat_pos` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `bssid_list` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rooms_room_id` (`room_id`),
  KEY `idx_rooms_org_id` (`org_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rooms`
--

LOCK TABLES `rooms` WRITE;
/*!40000 ALTER TABLE `rooms` DISABLE KEYS */;
INSERT INTO `rooms` VALUES (1,1,'801','{\"seats\":[{\"seatNumber\":\"A1\",\"x\":3,\"y\":1},{\"seatNumber\":\"B1\",\"x\":4,\"y\":1},{\"seatNumber\":\"C1\",\"x\":5,\"y\":1}]}','');
/*!40000 ALTER TABLE `rooms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `semesters`
--

DROP TABLE IF EXISTS `semesters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `semesters` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` datetime(3) DEFAULT NULL,
  `end_date` datetime(3) DEFAULT NULL,
  `time_slots` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_semesters_user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `semesters`
--

LOCK TABLES `semesters` WRITE;
/*!40000 ALTER TABLE `semesters` DISABLE KEYS */;
INSERT INTO `semesters` VALUES (2,1,'2025-2026第二学期','2026-03-02 08:00:00.000','2026-07-19 08:00:00.000','','2026-06-02 22:55:00.387'),(3,2,'2026第二学期','2026-03-02 08:00:00.000','2026-07-12 08:00:00.000','[{\"end\":\"08:45\",\"id\":1,\"label\":\"第1节\",\"start\":\"08:00\"},{\"end\":\"09:40\",\"id\":2,\"label\":\"第2节\",\"start\":\"08:55\"},{\"end\":\"10:45\",\"id\":3,\"label\":\"第3节\",\"start\":\"10:00\"},{\"end\":\"11:40\",\"id\":4,\"label\":\"第4节\",\"start\":\"10:55\"},{\"end\":\"14:45\",\"id\":5,\"label\":\"第5节\",\"start\":\"14:00\"},{\"end\":\"15:40\",\"id\":6,\"label\":\"第6节\",\"start\":\"14:55\"},{\"end\":\"16:45\",\"id\":7,\"label\":\"第7节\",\"start\":\"16:00\"},{\"end\":\"23:44\",\"id\":8,\"label\":\"第8节\",\"start\":\"23:00\"}]','2026-06-02 23:00:29.937');
/*!40000 ALTER TABLE `semesters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sign_absence_alerts`
--

DROP TABLE IF EXISTS `sign_absence_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sign_absence_alerts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` bigint unsigned NOT NULL,
  `course_id` bigint unsigned NOT NULL,
  `student_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `open_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `course_name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sign_absence_alerts_session_id` (`session_id`),
  KEY `idx_sign_absence_alerts_course_id` (`course_id`),
  KEY `idx_sign_absence_alerts_student_id` (`student_id`),
  KEY `idx_sign_absence_alerts_open_id` (`open_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sign_absence_alerts`
--

LOCK TABLES `sign_absence_alerts` WRITE;
/*!40000 ALTER TABLE `sign_absence_alerts` DISABLE KEYS */;
/*!40000 ALTER TABLE `sign_absence_alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sign_anomaly_alerts`
--

DROP TABLE IF EXISTS `sign_anomaly_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sign_anomaly_alerts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` bigint unsigned NOT NULL,
  `student_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `score` double DEFAULT NULL,
  `message` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seat_label` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_session_student_kind` (`session_id`,`student_id`,`kind`),
  KEY `idx_sign_anomaly_alerts_student_id` (`student_id`),
  KEY `idx_sign_anomaly_alerts_session_id` (`session_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sign_anomaly_alerts`
--

LOCK TABLES `sign_anomaly_alerts` WRITE;
/*!40000 ALTER TABLE `sign_anomaly_alerts` DISABLE KEYS */;
INSERT INTO `sign_anomaly_alerts` VALUES (1,1,'001','absent',1,'缺勤：Q','','2026-06-08 21:39:24.723'),(2,3,'001','absent',1,'缺勤：Q','','2026-06-08 21:55:26.483');
/*!40000 ALTER TABLE `sign_anomaly_alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sign_ins`
--

DROP TABLE IF EXISTS `sign_ins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sign_ins` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` bigint unsigned NOT NULL,
  `student_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `student_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `open_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seat_label` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `time` datetime(3) DEFAULT NULL,
  `ip` longtext COLLATE utf8mb4_unicode_ci,
  `device_id` longtext COLLATE utf8mb4_unicode_ci,
  `status` longtext COLLATE utf8mb4_unicode_ci,
  `sign_quality` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ok',
  `warn_reasons` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_session_student` (`session_id`,`student_id`),
  UNIQUE KEY `uniq_session_seat` (`session_id`,`seat_label`),
  UNIQUE KEY `uniq_session_openid` (`session_id`,`open_id`),
  KEY `idx_sign_ins_session_id` (`session_id`),
  KEY `idx_sign_ins_open_id` (`open_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sign_ins`
--

LOCK TABLES `sign_ins` WRITE;
/*!40000 ALTER TABLE `sign_ins` DISABLE KEYS */;
/*!40000 ALTER TABLE `sign_ins` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sign_leaves`
--

DROP TABLE IF EXISTS `sign_leaves`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sign_leaves` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` bigint unsigned NOT NULL,
  `student_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_session_leave_student` (`session_id`,`student_id`),
  KEY `idx_sign_leaves_session_id` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sign_leaves`
--

LOCK TABLES `sign_leaves` WRITE;
/*!40000 ALTER TABLE `sign_leaves` DISABLE KEYS */;
/*!40000 ALTER TABLE `sign_leaves` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sign_sessions`
--

DROP TABLE IF EXISTS `sign_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sign_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `course_id` bigint unsigned DEFAULT NULL,
  `room_id` longtext COLLATE utf8mb4_unicode_ci,
  `start_time` datetime(3) DEFAULT NULL,
  `end_time` datetime(3) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sign_sessions_course_id` (`course_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sign_sessions`
--

LOCK TABLES `sign_sessions` WRITE;
/*!40000 ALTER TABLE `sign_sessions` DISABLE KEYS */;
INSERT INTO `sign_sessions` VALUES (1,4,'801','2026-06-06 22:14:36.301','2026-06-08 21:39:24.704',0),(2,1,'801','2026-06-08 21:45:09.696','2026-06-08 21:47:25.640',0),(3,4,'801','2026-06-08 21:47:25.650','2026-06-08 21:55:26.477',0),(4,1,'801','2026-06-08 21:55:31.291','2026-06-09 19:54:18.182',0),(5,1,'801','2026-06-09 19:54:18.186','2026-06-09 19:55:00.898',0),(6,1,'801','2026-06-09 19:55:00.902','2026-06-09 19:55:32.533',0),(7,4,'801','2026-06-09 19:55:32.542','2026-06-09 20:13:07.548',0);
/*!40000 ALTER TABLE `sign_sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `students`
--

DROP TABLE IF EXISTS `students`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `students` (
  `student_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `student_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `org_id` bigint unsigned DEFAULT NULL,
  `created_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`student_id`),
  KEY `idx_students_org_id` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `students`
--

LOCK TABLES `students` WRITE;
/*!40000 ALTER TABLE `students` DISABLE KEYS */;
INSERT INTO `students` VALUES ('001','Q','$2b$12$1SuvIlPxc/.UfDoSuUWIau/ASB2JeKf7T2UqNZ./28.qMX2Xu4xHO',1,'2026-07-03 19:16:15.000'),('002','w','$2b$12$1SuvIlPxc/.UfDoSuUWIau/ASB2JeKf7T2UqNZ./28.qMX2Xu4xHO',1,'2026-07-03 19:16:15.000');
/*!40000 ALTER TABLE `students` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `org_id` bigint unsigned DEFAULT NULL,
  `pending_org_id` bigint unsigned DEFAULT NULL,
  `org_status` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_users_org_id` (`org_id`),
  KEY `idx_users_pending_org_id` (`pending_org_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin','$2a$10$T.n3fANvnYNEQ6T1zg43VuTrtNJg0bb14K/jEtzWtiQ1elYhRa.zG','org_owner',NULL,NULL,'approved','2026-05-31 22:11:32.000'),(2,'admin1','$2a$10$mMePFD0GqzspzkiOGyWgFuZVxUomTynJXs4HwUo1Sg8/z7NDye6DO','org_owner',1,NULL,'approved','2026-06-02 22:58:44.073');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-15 22:36:18
