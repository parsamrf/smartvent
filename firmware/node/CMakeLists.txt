# SmartVent sensor node (nice!nano / nRF52840, nRF Connect SDK / Zephyr)
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(smartvent_node)

target_sources(app PRIVATE
    src/main.c
    src/sensors.c
    src/control.c
    src/ble_service.c
    src/dfu_reboot.c
)
