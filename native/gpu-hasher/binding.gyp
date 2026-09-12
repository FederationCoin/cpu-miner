{
  "targets": [
    {
      "target_name": "gpu-hasher",
      "sources": [
        "src/addon.cpp",
        "src/blake2b.cpp",
        "src/sha256.cpp",
        "src/pow_cpu.cpp",
        "src/opencl_runtime.cpp",
        "src/grind.cpp"
      ],
      "include_dirs": ["include", "../../node_modules/node-addon-api"],
      "defines": ["NAPI_VERSION=8"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["-std:c++17"]
        }
      },
      "conditions": [
        ["OS=='linux'", { "libraries": ["-ldl"] }],
        ["OS=='win'", { "libraries": [] }],
        ["OS=='mac'", { "libraries": [] }]
      ]
    }
  ]
}
