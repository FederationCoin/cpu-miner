/** GPUBufferUsage / GPUMapMode are not always in lib.dom; GPUDevice is. */

declare const GPUBufferUsage: {
  readonly MAP_READ: number;
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly UNIFORM: number;
  readonly STORAGE: number;
};

declare const GPUMapMode: {
  readonly READ: number;
};
