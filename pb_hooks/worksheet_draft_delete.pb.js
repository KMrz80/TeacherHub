/// <reference path="../pocketbase/pb_data/types.d.ts" />

routerAdd("DELETE", "/api/teacherhub/worksheet-drafts/{worksheet_id}", (e) => {
  if (!e.auth || e.auth.getString("role") !== "teacher") return e.json(403, { success: false, error: "Teacher access required" })
  const worksheetId = e.request.pathValue("worksheet_id")
  let worksheet
  try { worksheet = e.app.findRecordById("worksheets", worksheetId) }
  catch (_) { return e.json(404, { success: false, error: "Worksheet draft not found" }) }
  if (worksheet.getString("status") !== "draft") return e.json(409, { success: false, error: "Можно удалять только черновики" })
  const homework = e.app.findRecordsByFilter("homework", "worksheet = {:worksheet}", "", 1, 0, { worksheet: worksheetId })
  if (homework.length) return e.json(409, { success: false, error: "Черновик связан с домашним заданием и не может быть удалён" })

  try {
    e.app.runInTransaction((txApp) => {
      const exercises = txApp.findRecordsByFilter("worksheet_exercises", "worksheet = {:worksheet}", "", 0, 0, { worksheet: worksheetId })
      const sources = txApp.findRecordsByFilter("worksheet_sources", "worksheet = {:worksheet}", "", 0, 0, { worksheet: worksheetId })
      for (const exercise of exercises) txApp.delete(exercise)
      for (const source of sources) txApp.delete(source)
      txApp.delete(txApp.findRecordById("worksheets", worksheetId))
    })
    return e.json(200, { success: true, worksheet_id: worksheetId })
  } catch (error) {
    console.error("[TeacherHub] worksheet draft delete error:", error)
    return e.json(500, { success: false, error: error && error.message || String(error) })
  }
}, $apis.requireAuth("users"))
