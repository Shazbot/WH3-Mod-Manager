import type * as ortTypes from "onnxruntime-node";
import {
  buildOnnxInputTensors,
  OnnxModelDefinition,
  OnnxPreprocessorInput,
  OnnxInputBinding,
  OnnxStandaloneInputMetadata,
  OnnxStandaloneMetadata,
} from "./onnxFlow";

export interface OnnxModelPayload {
  definition: OnnxModelDefinition;
  bytes?: Uint8Array;
}

export interface OnnxInferenceRequest {
  preprocessorBytes: Uint8Array;
  preprocessorOutput: string;
  inputs: OnnxPreprocessorInput[];
  inputBindings: Record<string, OnnxInputBinding>;
  categoricalMissing: string;
  rows: ReadonlyArray<ReadonlyArray<{ name: string; resolvedKeyValue: string }>>;
  models: OnnxModelPayload[];
  resolvePath: (
    path: import("./onnxFlow").OnnxJoinStep[],
    row: ReadonlyArray<{ name: string; resolvedKeyValue: string }>,
  ) => ReadonlyArray<{ name: string; resolvedKeyValue: string }> | undefined;
  batchSize?: number;
  intraOpNumThreads?: number;
}

export type OnnxPredictions = Record<string, number[]>;

export interface OnnxStandaloneInferenceRequest {
  modelBytes: Uint8Array;
  inputs: OnnxStandaloneInputMetadata[];
  inputBindings: Record<string, OnnxInputBinding[]>;
  outputName: string;
  rows: ReadonlyArray<ReadonlyArray<{ name: string; resolvedKeyValue: string }>>;
  resolvePath: OnnxInferenceRequest["resolvePath"];
  batchSize?: number;
  intraOpNumThreads?: number;
}

const BATCH_SIZE = 512;

const assertTensorMetadata = (
  metadata: ortTypes.InferenceSession.ValueMetadata | undefined,
  label: string,
  type: string,
  expectedWidth?: number,
) => {
  if (!metadata || !metadata.isTensor || metadata.type !== type) {
    throw new Error(`${label}: expected a ${type} tensor`);
  }
  if (!metadata.isTensor) throw new Error(`${label}: expected a tensor`);
  const shape = metadata.shape;
  if (shape.length !== 2) throw new Error(`${label}: expected a rank-2 [batch, feature] tensor`);
  const width = shape[1];
  if (typeof width === "number" && expectedWidth !== undefined && width !== expectedWidth) {
    throw new Error(`${label}: expected feature width ${expectedWidth}, received ${width}`);
  }
  if (typeof width === "number" && width < 1) throw new Error(`${label}: invalid feature width ${width}`);
  return typeof width === "number" ? width : expectedWidth;
};

const getBatchSize = (
  metadata: ortTypes.InferenceSession.ValueMetadata[],
  rowCount: number,
  requestedBatchSize: number,
  label: string,
): number => {
  const fixedDimensions = new Set<number>();
  for (const value of metadata) {
    if (!value.isTensor) throw new Error(`${label}: expected tensor metadata`);
    const dimension = value.shape[0];
    if (typeof dimension !== "number") continue;
    if (!Number.isInteger(dimension) || dimension < 1)
      throw new Error(`${label}: invalid batch dimension ${dimension}`);
    fixedDimensions.add(dimension);
  }
  if (fixedDimensions.size > 1) throw new Error(`${label}: tensor values use different fixed batch dimensions`);
  const fixed = fixedDimensions.values().next().value as number | undefined;
  if (fixed === undefined) return requestedBatchSize;
  if (rowCount % fixed !== 0) {
    throw new Error(`${label}: requires fixed batches of ${fixed}, but ${rowCount} rows cannot be divided evenly`);
  }
  return fixed;
};

const disposeTensors = (values: Record<string, ortTypes.OnnxValue> | undefined) => {
  if (!values) return;
  for (const value of Object.values(values)) {
    if (value && "dispose" in value && typeof value.dispose === "function") value.dispose();
  }
};

const asFloatData = (value: ortTypes.OnnxValue | undefined, label: string): Float32Array => {
  if (!value || !(value.data instanceof Float32Array)) throw new Error(`${label}: expected float32 tensor output`);
  for (const number of value.data) {
    if (!Number.isFinite(number)) throw new Error(`${label}: produced a non-finite value`);
  }
  return value.data;
};

const getSessionOptions = (intraOpNumThreads: number): ortTypes.InferenceSession.SessionOptions => ({
  executionProviders: ["cpu"],
  intraOpNumThreads,
  interOpNumThreads: 1,
  graphOptimizationLevel: "all",
});

export const inspectStandaloneOnnxBytes = async (bytes: Uint8Array): Promise<OnnxStandaloneMetadata> => {
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(bytes, getSessionOptions(1));
  try {
    const errors: string[] = [];
    const inputs = session.inputMetadata.map((metadata) => {
      if (
        !metadata.isTensor ||
        metadata.shape.length !== 2 ||
        (metadata.type !== "float32" && metadata.type !== "string")
      ) {
        errors.push(`Input '${metadata.name}' must be a rank-2 float32 or string tensor`);
        return { name: metadata.name, type: "float32" as const, width: 1 };
      }
      const width = typeof metadata.shape[1] === "number" ? metadata.shape[1] : 1;
      if (!Number.isInteger(width) || width < 1) errors.push(`Input '${metadata.name}' has invalid width ${width}`);
      return { name: metadata.name, type: metadata.type as "float32" | "string", width: Math.max(1, width) };
    });
    const outputs = session.outputMetadata.map((metadata) => {
      if (!metadata.isTensor) return { name: metadata.name, type: "non-tensor", shape: [] as Array<number | string> };
      return {
        name: metadata.name,
        type: metadata.type,
        shape: metadata.shape.map((dimension) => (typeof dimension === "number" ? dimension : String(dimension))),
      };
    });
    if (inputs.length === 0) errors.push("Model has no inputs");
    if (outputs.length === 0) errors.push("Model has no outputs");
    return { inputs, outputs, errors };
  } finally {
    await session.release();
  }
};

/** Runs one standalone packed model whose tensor inputs use [batch, feature] shapes. */
export const runOnnxStandaloneInference = async (request: OnnxStandaloneInferenceRequest): Promise<OnnxPredictions> => {
  const ort = await import("onnxruntime-node");
  const batchSize = Math.max(1, Math.min(4096, Math.floor(request.batchSize ?? BATCH_SIZE)));
  const intraOpNumThreads = Math.max(1, Math.min(8, Math.floor(request.intraOpNumThreads ?? 1)));
  const rowCount = request.rows.length;
  if (rowCount === 0) return { standalone: [] };
  const session = await ort.InferenceSession.create(request.modelBytes, getSessionOptions(intraOpNumThreads));
  try {
    if (
      session.inputNames.length !== request.inputs.length ||
      request.inputs.some((input) => !session.inputNames.includes(input.name))
    ) {
      throw new Error("Standalone model input metadata changed; inspect the packed model again");
    }
    if (!session.outputNames.includes(request.outputName))
      throw new Error(`Standalone model output '${request.outputName}' does not exist`);
    const perInputDescriptors: Record<string, OnnxPreprocessorInput[]> = {};
    const perInputBindings: Record<string, OnnxInputBinding> = {};
    for (const input of request.inputs) {
      const metadata = session.inputMetadata.find((candidate) => candidate.name === input.name);
      assertTensorMetadata(metadata, `standalone input '${input.name}'`, input.type, input.width);
      const bindings = request.inputBindings[input.name] || [];
      if (bindings.length !== input.width) {
        throw new Error(
          `Standalone input '${input.name}' needs ${input.width} feature bindings; found ${bindings.length}`,
        );
      }
      perInputDescriptors[input.name] = bindings.map((_binding, index) => {
        const key = `${input.name}\0${index}`;
        perInputBindings[key] = bindings[index];
        return { name: key, type: input.type };
      });
    }
    const outputMetadata = session.outputMetadata.find((candidate) => candidate.name === request.outputName);
    assertTensorMetadata(outputMetadata, `standalone output '${request.outputName}'`, "float32", 1);
    if (!outputMetadata?.isTensor) throw new Error(`Standalone output '${request.outputName}' must be a tensor`);
    const batchDimensions = getBatchSize(
      [...session.inputMetadata, outputMetadata],
      rowCount,
      batchSize,
      "standalone model",
    );
    const predictions = new Array<number>(rowCount);
    for (let offset = 0; offset < rowCount; offset += batchDimensions) {
      const batchRows = request.rows.slice(offset, Math.min(offset + batchDimensions, rowCount));
      const flatDescriptors = request.inputs.flatMap((input) => perInputDescriptors[input.name]);
      const rawFeeds = buildOnnxInputTensors(
        flatDescriptors,
        perInputBindings,
        batchRows,
        "__MISSING__",
        request.resolvePath,
      );
      const feeds: Record<string, ortTypes.OnnxValue> = {};
      for (const input of request.inputs) {
        const descriptors = perInputDescriptors[input.name];
        const values = descriptors.map((descriptor) => rawFeeds[descriptor.name]);
        if (input.type === "float32") {
          const data = new Float32Array(batchRows.length * input.width);
          for (let row = 0; row < batchRows.length; row++) {
            for (let column = 0; column < input.width; column++) {
              const value = Number(values[column].data[row]);
              if (!Number.isFinite(value))
                throw new Error(`Standalone input '${input.name}' contains a non-finite value`);
              data[row * input.width + column] = value;
            }
          }
          feeds[input.name] = new ort.Tensor("float32", data, [batchRows.length, input.width]);
        } else {
          const data = new Array<string>(batchRows.length * input.width);
          for (let row = 0; row < batchRows.length; row++) {
            for (let column = 0; column < input.width; column++) {
              data[row * input.width + column] = String(values[column].data[row]);
            }
          }
          feeds[input.name] = new ort.Tensor("string", data, [batchRows.length, input.width]);
        }
      }
      let outputs: ortTypes.InferenceSession.ReturnType | undefined;
      try {
        outputs = await session.run(feeds);
        const output = asFloatData(outputs[request.outputName], `standalone output '${request.outputName}'`);
        if (output.length !== batchRows.length)
          throw new Error(`Standalone output returned ${output.length} predictions for ${batchRows.length} rows`);
        for (let index = 0; index < output.length; index++) predictions[offset + index] = output[index];
      } finally {
        disposeTensors(feeds);
        disposeTensors(outputs);
      }
    }
    return { standalone: predictions };
  } finally {
    await session.release();
  }
};

/** Runs one bundle on CPU. The preprocessor is retained for the batch pass; prediction models open and close in order. */
export const runOnnxInference = async (request: OnnxInferenceRequest): Promise<OnnxPredictions> => {
  const ort = await import("onnxruntime-node");
  const batchSize = Math.max(1, Math.min(4096, Math.floor(request.batchSize ?? BATCH_SIZE)));
  const intraOpNumThreads = Math.max(1, Math.min(8, Math.floor(request.intraOpNumThreads ?? 1)));
  const options = getSessionOptions(intraOpNumThreads);
  const rowCount = request.rows.length;
  if (rowCount === 0) return Object.fromEntries(request.models.map((model) => [model.definition.key, []]));

  const preprocessor = await ort.InferenceSession.create(request.preprocessorBytes, options);
  try {
    const expectedInputNames = request.inputs.map((input) => input.name);
    if (
      preprocessor.inputNames.length !== expectedInputNames.length ||
      expectedInputNames.some((name) => !preprocessor.inputNames.includes(name))
    ) {
      throw new Error("preprocessor ONNX inputs do not match preprocessor.json");
    }
    const preprocessorInputMetadata: ortTypes.InferenceSession.ValueMetadata[] = [];
    for (const input of request.inputs) {
      const metadata = preprocessor.inputMetadata.find((candidate) => candidate.name === input.name);
      assertTensorMetadata(metadata, `preprocessor input '${input.name}'`, input.type);
      if (metadata?.isTensor && typeof metadata.shape[1] === "number" && metadata.shape[1] !== 1) {
        throw new Error(`preprocessor input '${input.name}': expected shape [batch, 1]`);
      }
      if (metadata) preprocessorInputMetadata.push(metadata);
    }
    if (preprocessor.outputNames.length !== 1 || preprocessor.outputNames[0] !== request.preprocessorOutput) {
      throw new Error(`preprocessor ONNX must produce '${request.preprocessorOutput}' as its only output`);
    }
    const transformedWidth = assertTensorMetadata(
      preprocessor.outputMetadata.find((candidate) => candidate.name === request.preprocessorOutput),
      "preprocessor output",
      "float32",
    );
    if (!transformedWidth) throw new Error("preprocessor output feature width is dynamic and cannot be inferred");

    const preprocessorOutputMetadata = preprocessor.outputMetadata.find(
      (candidate) => candidate.name === request.preprocessorOutput,
    )!;
    const preprocessorBatchSize = getBatchSize(
      [...preprocessorInputMetadata, preprocessorOutputMetadata],
      rowCount,
      batchSize,
      "preprocessor",
    );
    const transformedValueCount = rowCount * transformedWidth;
    const transformedBytes = transformedValueCount * Float32Array.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(transformedValueCount) || transformedBytes > 256 * 1024 * 1024) {
      throw new Error(
        `ONNX preprocessing output would use ${Math.ceil(transformedBytes / 1024 / 1024)} MiB; limit is 256 MiB. Reduce the input row count.`,
      );
    }
    const transformedFeatures = new Float32Array(transformedValueCount);
    for (let offset = 0; offset < rowCount; offset += preprocessorBatchSize) {
      const batchRows = request.rows.slice(offset, Math.min(offset + preprocessorBatchSize, rowCount));
      const rawFeeds = buildOnnxInputTensors(
        request.inputs,
        request.inputBindings,
        batchRows,
        request.categoricalMissing,
        request.resolvePath,
      );
      const feeds: Record<string, ortTypes.OnnxValue> = {};
      for (const input of request.inputs) {
        const tensor = rawFeeds[input.name];
        feeds[input.name] = new ort.Tensor(tensor.type, tensor.data, tensor.dims);
      }
      let outputs: ortTypes.InferenceSession.ReturnType | undefined;
      try {
        outputs = await preprocessor.run(feeds);
        const batchFeatures = asFloatData(outputs[request.preprocessorOutput], "preprocessor output");
        const expectedLength = batchRows.length * transformedWidth;
        if (batchFeatures.length !== expectedLength) {
          throw new Error(`preprocessor output has ${batchFeatures.length} values; expected ${expectedLength}`);
        }
        transformedFeatures.set(batchFeatures, offset * transformedWidth);
      } finally {
        disposeTensors(feeds);
        disposeTensors(outputs);
      }
    }

    const predictions: OnnxPredictions = {};
    for (const model of request.models) {
      if (typeof model.definition.constant === "number") {
        if (!Number.isFinite(model.definition.constant))
          throw new Error(`Model '${model.definition.key}' has a non-finite constant`);
        predictions[model.definition.key] = Array(rowCount).fill(model.definition.constant);
        continue;
      }
      if (!model.bytes) throw new Error(`Missing ONNX model bytes for '${model.definition.key}'`);

      const session = await ort.InferenceSession.create(model.bytes, options);
      try {
        if (session.inputNames.length !== 1 || session.outputNames.length !== 1) {
          throw new Error(`Model '${model.definition.key}' must have one tensor input and one tensor output`);
        }
        const inputWidth = assertTensorMetadata(
          session.inputMetadata[0],
          `model '${model.definition.key}' input`,
          "float32",
          transformedWidth,
        );
        if (inputWidth !== transformedWidth) {
          throw new Error(
            `Model '${model.definition.key}' expects ${inputWidth} features; preprocessor emits ${transformedWidth}`,
          );
        }
        assertTensorMetadata(session.outputMetadata[0], `model '${model.definition.key}' output`, "float32", 1);
        const modelBatchSize = getBatchSize(
          [...session.inputMetadata, ...session.outputMetadata],
          rowCount,
          batchSize,
          `model '${model.definition.key}'`,
        );
        const result = new Array<number>(rowCount);
        for (let offset = 0; offset < rowCount; offset += modelBatchSize) {
          const batchCount = Math.min(modelBatchSize, rowCount - offset);
          const start = offset * transformedWidth;
          const inputData = transformedFeatures.subarray(start, start + batchCount * transformedWidth);
          const feed = new ort.Tensor("float32", inputData, [batchCount, transformedWidth]);
          const feeds = { [session.inputNames[0]]: feed };
          let outputs: ortTypes.InferenceSession.ReturnType | undefined;
          try {
            outputs = await session.run(feeds);
            const values = asFloatData(outputs[session.outputNames[0]], `model '${model.definition.key}' output`);
            if (values.length !== batchCount) {
              throw new Error(
                `Model '${model.definition.key}' returned ${values.length} predictions for ${batchCount} rows`,
              );
            }
            for (let index = 0; index < batchCount; index++) result[offset + index] = values[index];
          } finally {
            disposeTensors(feeds);
            disposeTensors(outputs);
          }
        }
        predictions[model.definition.key] = result;
      } finally {
        await session.release();
      }
    }
    return predictions;
  } finally {
    await preprocessor.release();
  }
};
