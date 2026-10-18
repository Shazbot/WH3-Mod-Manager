add_library(NativePatchCompanion SHARED companion.cpp)
add_executable(NativePatchStartupHarness main.cpp)
target_link_libraries(NativePatchStartupHarness PRIVATE NativePatchCompanion)

set(HARNESS_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/harness-bin")
set_target_properties(NativePatchStartupHarness PROPERTIES
  ENABLE_EXPORTS ON
  RUNTIME_OUTPUT_DIRECTORY "${HARNESS_OUTPUT_DIRECTORY}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${HARNESS_OUTPUT_DIRECTORY}"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${HARNESS_OUTPUT_DIRECTORY}"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${HARNESS_OUTPUT_DIRECTORY}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${HARNESS_OUTPUT_DIRECTORY}"
)
set_target_properties(NativePatchCompanion PROPERTIES
  OUTPUT_NAME "NativePatchCompanion"
  RUNTIME_OUTPUT_DIRECTORY "${HARNESS_OUTPUT_DIRECTORY}/companions"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${HARNESS_OUTPUT_DIRECTORY}/companions"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${HARNESS_OUTPUT_DIRECTORY}/companions"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${HARNESS_OUTPUT_DIRECTORY}/companions"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${HARNESS_OUTPUT_DIRECTORY}/companions"
)

set_property(TARGET NativePatchStartupHarness PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set_property(TARGET NativePatchCompanion PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
foreach(target NativePatchStartupHarness NativePatchCompanion)
  target_compile_features(${target} PRIVATE cxx_std_20)
  target_compile_options(${target} PRIVATE /W4 /EHsc /Brepro $<$<CONFIG:Release>:/O2>)
  target_link_options(${target} PRIVATE /Brepro /INCREMENTAL:NO)
endforeach()
