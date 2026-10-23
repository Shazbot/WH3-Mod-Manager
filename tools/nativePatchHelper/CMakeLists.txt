cmake_minimum_required(VERSION 3.24)
project(WH3NativePatchHelper LANGUAGES CXX)

cmake_policy(SET CMP0091 NEW)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "WH3NativePatchHelper must be built for Windows x64.")
endif()

add_executable(WH3NativePatchHelper main.cpp)
target_compile_features(WH3NativePatchHelper PRIVATE cxx_std_20)
target_compile_definitions(WH3NativePatchHelper PRIVATE UNICODE _UNICODE)
if(MSVC)
  set_property(TARGET WH3NativePatchHelper PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  target_compile_options(WH3NativePatchHelper PRIVATE /W4 /EHsc /Brepro $<$<CONFIG:Release>:/O2>)
  target_link_options(WH3NativePatchHelper PRIVATE /Brepro /INCREMENTAL:NO)
else()
  message(FATAL_ERROR "Use the Microsoft Visual C++ compiler to produce the reproducible helper.")
endif()
target_link_libraries(WH3NativePatchHelper PRIVATE bcrypt)

set_target_properties(WH3NativePatchHelper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_CURRENT_SOURCE_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_CURRENT_SOURCE_DIR}"
)

add_subdirectory(harness)
