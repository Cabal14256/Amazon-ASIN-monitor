const ASIN_NOT_FOUND_ERROR_TYPE = 'NOT_FOUND';

function parseResponsePayload(value) {
  if (!value) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    value = value.toString('utf8');
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  return typeof value === 'object' ? value : null;
}

function payloadContainsNotFoundCode(payload) {
  const parsedPayload = parseResponsePayload(payload);
  if (!parsedPayload) {
    return false;
  }

  const codes = [
    parsedPayload.code,
    ...(Array.isArray(parsedPayload.errors)
      ? parsedPayload.errors.map((error) => error?.code)
      : []),
  ];

  return codes.some(
    (code) =>
      String(code || '')
        .trim()
        .toUpperCase() === 'NOT_FOUND',
  );
}

/**
 * Catalog Items API 的 404 + NOT_FOUND 表示商品在目标 Marketplace 中不存在。
 * 只有同时满足 HTTP 状态和 Amazon 业务错误码时才视为终态，避免把网关 404
 * 等基础设施故障误判为商品异常。
 *
 * @param {Error|Object} error
 * @returns {boolean}
 */
function isCatalogItemNotFoundError(error) {
  if (!error) {
    return false;
  }

  const statusCode = Number(
    error.statusCode ?? error.response?.statusCode ?? error.response?.status,
  );
  if (statusCode !== 404) {
    return false;
  }

  const directCodes = [error.code];
  if (
    directCodes.some(
      (code) =>
        String(code || '')
          .trim()
          .toUpperCase() === 'NOT_FOUND',
    )
  ) {
    return true;
  }

  return [error.responseData, error.errorDetails, error.response?.data].some(
    payloadContainsNotFoundCode,
  );
}

function buildASINNotFoundResult({
  asin,
  country,
  apiVersion = '2022-04-01',
  source = 'spapi',
}) {
  return {
    hasVariants: false,
    variantCount: 0,
    errorType: ASIN_NOT_FOUND_ERROR_TYPE,
    details: {
      asin,
      country,
      title: '',
      brand: null,
      parentAsin: null,
      variations: [],
      relationships: [],
      notFound: true,
    },
    meta: {
      source,
      apiVersion,
    },
  };
}

module.exports = {
  ASIN_NOT_FOUND_ERROR_TYPE,
  buildASINNotFoundResult,
  isCatalogItemNotFoundError,
};
