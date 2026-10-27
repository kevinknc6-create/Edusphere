// Thin client for the EduSphere API used by the existing application.
export class ApiError extends Error {
  constructor(code, message, fields = {}, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method,
      headers: body === undefined ? { Accept: "application/json" } : {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", "Couldn't reach EduSphere. Check your connection and try again.");
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    if (response.ok && response.status !== 204) {
      throw new ApiError("invalid_response", "The server returned an invalid response.", {}, response.status);
    }
  }

  if (!response.ok) {
    const error = data?.error || {};
    throw new ApiError(
      error.code || "server_error",
      error.message || data?.message || "Something went wrong. Please try again.",
      error.fields || data?.fields || {},
      response.status,
    );
  }
  return data;
}
