cmake_minimum_required(VERSION 3.20)
cmake_policy(SET CMP0091 NEW)
project(whmm_cli_launcher LANGUAGES CXX RC)

set(WHMM_VERSION "0.0.0" CACHE STRING "WHMM version embedded in the launcher's version resource")
if(NOT WHMM_VERSION MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)")
  message(FATAL_ERROR "WHMM_VERSION '${WHMM_VERSION}' must start with MAJOR.MINOR.PATCH")
endif()
set(WHMM_VERSION_MAJOR ${CMAKE_MATCH_1})
set(WHMM_VERSION_MINOR ${CMAKE_MATCH_2})
set(WHMM_VERSION_PATCH ${CMAKE_MATCH_3})

add_executable(whmm-cli launcher.cpp launcher.rc whmm-cli.manifest)
target_compile_features(whmm-cli PRIVATE cxx_std_17)
target_compile_definitions(whmm-cli PRIVATE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
  WHMM_VERSION_MAJOR=${WHMM_VERSION_MAJOR}
  WHMM_VERSION_MINOR=${WHMM_VERSION_MINOR}
  WHMM_VERSION_PATCH=${WHMM_VERSION_PATCH}
  WHMM_VERSION_STRING=${WHMM_VERSION})
target_compile_options(whmm-cli PRIVATE
  $<$<COMPILE_LANGUAGE:CXX>:/W4 /permissive- /EHsc /utf-8 /guard:cf>)
target_link_options(whmm-cli PRIVATE /guard:cf /DYNAMICBASE /NXCOMPAT)
set_target_properties(whmm-cli PROPERTIES CXX_EXTENSIONS OFF MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
