// Copy this file to secrets.h and fill in your values.
// secrets.h is git-ignored: never commit Wi-Fi passwords or device certificates.
#pragma once

#define WIFI_SSID "your-ssid"
#define WIFI_PASSWORD "your-password"

// AWS IoT Core data endpoint: `aws iot describe-endpoint --endpoint-type iot:Data-ATS`
#define AWS_IOT_ENDPOINT "xxxxxxxxxxxxxx-ats.iot.us-west-2.amazonaws.com"

// Must match the IoT Thing name and the MQTT client id allowed by the IoT policy.
#define THING_NAME "smartvent-gateway"

// Amazon Root CA 1 (https://www.amazontrust.com/repository/AmazonRootCA1.pem)
static const char AWS_ROOT_CA[] = R"EOF(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)EOF";

// Device certificate (xxxx-certificate.pem.crt)
static const char DEVICE_CERT[] = R"KEY(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)KEY";

// Device private key (xxxx-private.pem.key)
static const char DEVICE_PRIVATE_KEY[] = R"KEY(
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
)KEY";
