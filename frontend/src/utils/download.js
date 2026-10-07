// Save a file returned by the API (axios response with responseType "blob").
export function saveDownload(response, fallbackName) {
  const header = response.headers?.["content-disposition"] || ""
  const match = /filename="?([^";]+)"?/i.exec(header)
  const url = URL.createObjectURL(response.data)
  const a = document.createElement("a")
  a.href = url
  a.download = match ? match[1] : fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
