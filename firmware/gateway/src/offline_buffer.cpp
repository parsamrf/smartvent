#include "config.h"
#include "offline_buffer.h"

void OfflineBuffer::push(const TelemetrySample &s) {
    if (count_ == OFFLINE_BUFFER_CAPACITY) {
        // Full: drop the oldest to make room.
        head_ = (head_ + 1) % OFFLINE_BUFFER_CAPACITY;
        count_--;
        dropped_++;
    }
    items_[(head_ + count_) % OFFLINE_BUFFER_CAPACITY] = s;
    count_++;
}

bool OfflineBuffer::peek(TelemetrySample &out) const {
    if (count_ == 0) return false;
    out = items_[head_];
    return true;
}

void OfflineBuffer::pop() {
    if (count_ == 0) return;
    head_ = (head_ + 1) % OFFLINE_BUFFER_CAPACITY;
    count_--;
}
