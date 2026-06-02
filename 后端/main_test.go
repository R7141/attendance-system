package main

import (
	"fmt"
	"testing"
	"time"
)

func TestVerifyQRcode_Valid(t *testing.T) {
	SecretKey = "test-secret"
	iat := time.Now().Add(-10 * time.Second).UTC()
	ttl := "5m"
	d, _ := time.ParseDuration(ttl)
	signContent := fmt.Sprintf("%s|%s|%s|%s|%s", "R1", "A1", iat.Format(time.RFC3339), d.String(), "v1")
	sig := HmacSha256ToBase64(SecretKey, signContent)

	ok, err := verifyQRcode(QRcode{
		Ver:  "v1",
		Seat: "A1",
		Room: "R1",
		Iat:  iat.Format(time.RFC3339),
		Ttl:  ttl,
		Sig:  sig,
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !ok {
		t.Fatalf("expected ok=true")
	}
}

func TestVerifyQRcode_BadSig(t *testing.T) {
	SecretKey = "test-secret"
	iat := time.Now().Add(-10 * time.Second).UTC()
	ok, err := verifyQRcode(QRcode{
		Ver:  "v1",
		Seat: "A1",
		Room: "R1",
		Iat:  iat.Format(time.RFC3339),
		Ttl:  "5m",
		Sig:  "bad",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if ok {
		t.Fatalf("expected ok=false")
	}
}
