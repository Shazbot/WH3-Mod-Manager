cmake_minimum_required(VERSION 3.20)

cmake_policy(SET CMP0091 NEW)

project(whmm_cli_launcher LANGUAGES CXX)

add_executable(whmm-cli launcher.cpp)
target_compile_features(whmm-cli PRIVATE cxx_std_17)
target_compile_definitions(whmm-cli PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(whmm-cli PRIVATE /W4 /permissive- /EHsc /utf-8)
set_target_properties(whmm-cli PROPERTIES
  CXX_EXTENSIONS OFF
  MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
)
