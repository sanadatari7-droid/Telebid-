// FastAPI validation errors (422) return `detail` as an array of
// { type, loc, msg, input } objects rather than a string. Passing that
// straight to toast.error() crashes React ("Objects are not valid as a
// React child") since react-hot-toast renders the message as a child node —
// and because <Toaster> sits outside any page-level ErrorBoundary, that
// crash takes down the whole app. Always route API errors through this
// helper so callers get a safe, human-readable string.
export function apiErrorMessage(err, fallback = "Something went wrong") {
  const detail = err?.response?.data?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    return detail.map(d => (typeof d === "string" ? d : d?.msg)).filter(Boolean).join("; ") || fallback
  }
  if (detail && typeof detail === "object" && detail.msg) return detail.msg
  return fallback
}
