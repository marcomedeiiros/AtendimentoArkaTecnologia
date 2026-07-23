function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      result.error.isValidation = true;
      return next(result.error);
    }
    req[source] = result.data;
    return next();
  };
}

module.exports = validate;
