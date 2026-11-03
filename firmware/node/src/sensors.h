#ifndef SMARTVENT_SENSORS_H
#define SMARTVENT_SENSORS_H

#include <stdbool.h>
#include <stdint.h>

struct sensor_reading {
	int16_t temp_centi;   /* 0.01 degC */
	uint16_t hum_centi;   /* 0.01 %RH */
	uint16_t aq_mv;       /* MQ-135 output, millivolts */
	bool th_ok;           /* temperature/humidity valid */
	bool aq_ok;           /* air quality valid */
};

/* Prepare the BME280 and ADC. Returns 0 even if a sensor is missing; missing
 * sensors are reported through the *_ok flags of each reading. */
int sensors_init(void);

/* Take one sample of every sensor. */
void sensors_read(struct sensor_reading *out);

#endif
