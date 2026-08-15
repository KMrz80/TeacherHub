/// <reference path="../pocketbase/pb_data/types.d.ts" />

function actionError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function actionText(value) {
  return typeof value === "string" ? value.trim() : ""
}

function actionContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return JSON.parse(JSON.stringify(value))
}

function actionCorrectAnswer(type, content) {
  if (Object.prototype.hasOwnProperty.call(content, "correct_answer")) return content.correct_answer
  if (type === "text_input" && actionText(content.answer)) return [actionText(content.answer)]
  if (type === "reorder_words" && Array.isArray(content.correct_sequence)) return content.correct_sequence
  if (type === "matching" && Array.isArray(content.pairs)) {
    const pairs = content.pairs.filter((pair) => pair && typeof pair === "object" && !Array.isArray(pair) && actionText(pair.left) && actionText(pair.right))
    if (pairs.length === content.pairs.length) return Object.fromEntries(pairs.map((pair) => [actionText(pair.left), actionText(pair.right)]))
  }
  if (type === "dropdown" && Array.isArray(content.items)) return content.items.map((item) => item && item.correct_answer)
  return undefined
}

routerAdd("POST", "/api/teacherhub/worksheet-drafts", (e) => {
  const configuredKey = $os.getenv("TEACHERHUB_ACTION_KEY")
  const authorization = e.request.header.get("Authorization") || ""
  const suppliedKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!configuredKey || !suppliedKey || suppliedKey !== configuredKey) return e.json(401, { success: false, error: "Unauthorized" })

  try {
    const body = e.requestInfo().body || {}
    const title = actionText(body.title)
    const learningGoal = actionText(body.learning_goal)
    if (!title) throw actionError("Поле title обязательно", 400)
    if (!learningGoal) throw actionError("Поле learning_goal обязательно", 400)
    if (!Array.isArray(body.exercises) || !body.exercises.length) throw actionError("Поле exercises должно содержать хотя бы одно упражнение", 400)

    const teachers = e.app.findRecordsByFilter("users", 'role = "teacher"', "created", 2, 0)
    if (teachers.length !== 1) throw actionError("Для Action endpoint должен быть настроен ровно один teacher-аккаунт", 500)

    const studentId = actionText(body.student_id)
    if (studentId) {
      try { e.app.findRecordById("students", studentId) }
      catch (_) { throw actionError("Ученик с указанным student_id не найден", 404) }
    }

    const exerciseCollection = e.app.findCollectionByNameOrId("worksheet_exercises")
    const allowedTypes = Array.from(exerciseCollection.fields.getByName("type").values || [])
    const exercises = body.exercises.map((exercise, index) => {
      if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) throw actionError(`Упражнение ${index + 1}: неверный формат`, 400)
      const type = actionText(exercise.type), instruction = actionText(exercise.instruction), content = actionContent(exercise.content)
      if (!allowedTypes.includes(type)) throw actionError(`Упражнение ${index + 1}: неизвестный type`, 400)
      if (!instruction) throw actionError(`Упражнение ${index + 1}: instruction обязателен`, 400)
      if (!content) throw actionError(`Упражнение ${index + 1}: content должен быть объектом`, 400)
      const points = Number(exercise.points), order = Number(exercise.order)
      if (!Number.isFinite(points) || points < 0) throw actionError(`Упражнение ${index + 1}: points должен быть неотрицательным числом`, 400)
      return { type, instruction, content, points, order: Number.isFinite(order) && order >= 0 ? order : index, correctAnswer: actionCorrectAnswer(type, content) }
    })

    let worksheetId = ""
    e.app.runInTransaction((txApp) => {
      const worksheet = new Record(txApp.findCollectionByNameOrId("worksheets"))
      worksheet.set("title", title)
      worksheet.set("instructions", learningGoal)
      worksheet.set("status", "draft")
      worksheet.set("created_by", teachers[0].id)
      worksheet.set("student", studentId)
      worksheet.set("level", actionText(body.level))
      worksheet.set("focus", actionText(body.focus))
      worksheet.set("estimated_time", actionText(body.estimated_time))
      worksheet.set("source_notes", actionText(body.source_notes))
      txApp.save(worksheet)
      worksheetId = worksheet.id

      const collection = txApp.findCollectionByNameOrId("worksheet_exercises")
      for (const data of exercises) {
        const exercise = new Record(collection)
        exercise.set("worksheet", worksheet.id)
        exercise.set("type", data.type)
        exercise.set("instruction", data.instruction)
        exercise.set("content", data.content)
        if (data.correctAnswer !== undefined) exercise.set("correct_answer", data.correctAnswer)
        exercise.set("order", data.order)
        exercise.set("points", data.points)
        txApp.save(exercise)
      }
    })

    return e.json(200, { success: true, worksheet_id: worksheetId, status: "draft" })
  } catch (error) {
    const status = Number(error && error.status) || 500
    const safeMessage = status < 500 || error.status ? String(error.message || error) : "Не удалось сохранить worksheet draft"
    if (status >= 500) console.log(`[TeacherHub Action] worksheet draft error: ${String(error && error.message || error)}`)
    return e.json(status, { success: false, error: safeMessage })
  }
})
