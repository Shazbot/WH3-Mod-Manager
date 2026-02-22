export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    const isRelativeSpecifier = specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelativeSpecifier && error && error.code === "ERR_MODULE_NOT_FOUND") {
      return defaultResolve(`${specifier}.ts`, context, defaultResolve);
    }

    throw error;
  }
}
