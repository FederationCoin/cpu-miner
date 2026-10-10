CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Iinclude
UNAME := $(shell uname -s)
ifeq ($(UNAME),Linux)
LIBS ?= -ldl -pthread
else
LIBS ?= -pthread
endif

.PHONY: test clean

test: test-cpu-hash
	./test-cpu-hash

test-cpu-hash: test/test_cpu_hash.cpp src/blake2b.cpp src/sha256.cpp src/pow_cpu.cpp src/opencl_runtime.cpp
	$(CXX) $(CXXFLAGS) -o $@ test/test_cpu_hash.cpp src/blake2b.cpp src/sha256.cpp src/pow_cpu.cpp src/opencl_runtime.cpp $(LIBS)

clean:
	rm -f test-cpu-hash
	rm -rf build dist
