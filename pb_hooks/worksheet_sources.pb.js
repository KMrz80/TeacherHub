/// <reference path="../pocketbase/pb_data/types.d.ts" />

routerAdd("GET", "/api/teacherhub/worksheets/{worksheet_id}/sources", (e) => {
  const configuredKey = $os.getenv("TEACHERHUB_ACTION_KEY")
  const authorization = e.request.header.get("Authorization") || ""
  const suppliedKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!configuredKey || !suppliedKey || suppliedKey !== configuredKey) return e.json(401, { success: false, error: "Unauthorized" })

  const worksheetId = e.request.pathValue("worksheet_id")
  try { e.app.findRecordById("worksheets", worksheetId) }
  catch (_) { return e.json(404, { success: false, error: "Worksheet not found" }) }

  try {
    const forwardedProto = (e.request.header.get("X-Forwarded-Proto") || "").split(",")[0].trim()
    const forwardedHost = (e.request.header.get("X-Forwarded-Host") || "").split(",")[0].trim()
    let protocol = forwardedProto || e.request.url.scheme || "https"
    const host = forwardedHost || e.request.url.host
    if (protocol !== "https" && !/^localhost(?::|$)|^127\.0\.0\.1(?::|$)/.test(host)) protocol = "https"
    const origin = `${protocol}://${host}`
    const mimeType = (filename) => {
      const extension = String(filename || "").split(".").pop().toLowerCase()
      return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })[extension] || null
    }
    const fileUrl = (collection, recordId, filename) => filename ? `${origin}/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}` : null
    const records = e.app.findRecordsByFilter("worksheet_sources", "worksheet = {:worksheet}", "order", 0, 0, { worksheet: worksheetId })
    const sources = records.map((source) => {
      const materialId = source.getString("material")
      const metadata = source.get("metadata") || {}
      let title = source.getString("uploaded_file") || source.getString("file") || "Source"
      let filename = source.getString("uploaded_file") || source.getString("file")
      let url = fileUrl("worksheet_sources", source.id, filename)
      if (materialId) {
        const material = e.app.findRecordById("materials", materialId)
        title = material.getString("title") || title
        filename = material.getString("file")
        url = fileUrl("materials", material.id, filename)
      }
      return { source_id: source.id, material_id: materialId || null, title, mime_type: mimeType(filename), file_url: url, metadata: { page_selections: Array.isArray(metadata.page_selections) ? metadata.page_selections : [], unit: metadata.unit || "", teacher_note: metadata.teacher_note || "", ...(metadata.pages ? { pages: metadata.pages } : {}), ...(metadata.exercises ? { exercises: metadata.exercises } : {}) } }
    })
    return e.json(200, { success: true, worksheet_id: worksheetId, sources })
  } catch (error) {
    console.error("[TeacherHub Action] worksheet sources error:", error)
    return e.json(500, { success: false, error: error && error.message || String(error) })
  }
})
