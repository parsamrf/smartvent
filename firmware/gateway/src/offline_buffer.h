#pragma once
#include "config.h"
#include "telemetry.h"

// Fixed-size FIFO ring buffer holding readings received while the cloud
// connection is down (ECE 513 offline data recovery). When full, the oldest
// sample is overwritten so the most recent history is always kept.
class OfflineBuffer {
public:
    void push(const TelemetrySample &s);
    // Copy the oldest sample into `out` without removing it.
    bool peek(TelemetrySample &out) const;
    // Remove the oldest sample (call only after it was published successfully).
    void pop();
    size_t size() const { return count_; }
    size_t dropped() const { return dropped_; }

private:
    TelemetrySample items_[OFFLINE_BUFFER_CAPACITY];
    size_t head_ = 0;  // index of the oldest element
    size_t count_ = 0;
    size_t dropped_ = 0;
};
