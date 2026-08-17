/// <reference path="../pocketbase/pb_data/types.d.ts" />

routerAdd("POST", "/api/teacherhub/worksheet-drafts", (e) => {
  const text = (value) => typeof value === "string" ? value.trim() : ""
  const actionError = (message, status) => {
    const error = new Error(message)
    error.status = status
    return error
  }
  const actionContent = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return JSON.parse(JSON.stringify(value))
  }
  const actionCorrectAnswer = (type, content) => {
    if (Object.prototype.hasOwnProperty.call(content, "correct_answer")) return content.correct_answer
    if (type === "text_input" && text(content.answer)) return [text(content.answer)]
    if (type === "reorder_words" && Array.isArray(content.correct_sequence)) return content.correct_sequence
    if (type === "matching" && Array.isArray(content.pairs)) {
      const pairs = content.pairs.filter((pair) => pair && typeof pair === "object" && !Array.isArray(pair) && text(pair.left) && text(pair.right))
      if (pairs.length === content.pairs.length) return Object.fromEntries(pairs.map((pair) => [text(pair.left), text(pair.right)]))
    }
    if (type === "dropdown" && Array.isArray(content.items)) return content.items.map((item) => item && item.correct_answer)
    return undefined
  }
  const configuredKey = $os.getenv("TEACHERHUB_ACTION_KEY")
  const authorization = e.request.header.get("Authorization") || ""
  const suppliedKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!configuredKey || !suppliedKey || suppliedKey !== configuredKey) return e.json(401, { success: false, error: "Unauthorized" })

  try {
    const body = e.requestInfo().body || {}
    const title = text(body.title)
    const learningGoal = text(body.learning_goal)
    if (!title) throw actionError("Поле title обязательно", 400)
    if (!learningGoal) throw actionError("Поле learning_goal обязательно", 400)
    if (!Array.isArray(body.exercises) || !body.exercises.length) throw actionError("Поле exercises должно содержать хотя бы одно упражнение", 400)

    const teachers = e.app.findRecordsByFilter("users", 'role = "teacher"', "created", 2, 0)
    if (teachers.length !== 1) throw actionError("Для Action endpoint должен быть настроен ровно один teacher-аккаунт", 500)

    const requestedWorksheetId = text(body.worksheet_id)
    if (requestedWorksheetId) {
      let existingWorksheet
      try { existingWorksheet = e.app.findRecordById("worksheets", requestedWorksheetId) }
      catch (_) { throw actionError("Worksheet с указанным worksheet_id не найден", 404) }
      if (existingWorksheet.getString("status") !== "draft") throw actionError("Обновлять через Action можно только worksheet draft", 400)
    }

    const studentId = text(body.student_id)
    if (studentId) {
      try { e.app.findRecordById("students", studentId) }
      catch (_) { throw actionError("Ученик с указанным student_id не найден", 404) }
    }

    const exerciseCollection = e.app.findCollectionByNameOrId("worksheet_exercises")
    const allowedTypes = Array.from(exerciseCollection.fields.getByName("type").values || [])
    const exercises = body.exercises.map((exercise, index) => {
      if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) throw actionError(`Упражнение ${index + 1}: неверный формат`, 400)
      const type = text(exercise.type), instruction = text(exercise.instruction), content = actionContent(exercise.content)
      if (!allowedTypes.includes(type)) throw actionError(`Упражнение ${index + 1}: неизвестный type`, 400)
      if (!instruction) throw actionError(`Упражнение ${index + 1}: instruction обязателен`, 400)
      if (!content) throw actionError(`Упражнение ${index + 1}: content должен быть объектом`, 400)
      const points = Number(exercise.points), order = Number(exercise.order)
      if (!Number.isFinite(points) || points < 0) throw actionError(`Упражнение ${index + 1}: points должен быть неотрицательным числом`, 400)
      return { type, instruction, content, points, order: Number.isFinite(order) && order >= 0 ? order : index, correctAnswer: actionCorrectAnswer(type, content) }
    })

    let worksheetId = ""
    e.app.runInTransaction((txApp) => {
      const worksheet = requestedWorksheetId
        ? txApp.findRecordById("worksheets", requestedWorksheetId)
        : new Record(txApp.findCollectionByNameOrId("worksheets"))
      worksheet.set("title", title)
      worksheet.set("instructions", learningGoal)
      worksheet.set("intro_text", text(body.intro_text))
      worksheet.set("status", "draft")
      worksheet.set("created_by", teachers[0].id)
      worksheet.set("student", studentId)
      worksheet.set("level", text(body.level))
      worksheet.set("focus", text(body.focus))
      worksheet.set("estimated_time", text(body.estimated_time))
      worksheet.set("source_notes", text(body.source_notes))
      txApp.save(worksheet)
      worksheetId = worksheet.id

      const collection = txApp.findCollectionByNameOrId("worksheet_exercises")
      if (requestedWorksheetId) {
        const previousExercises = txApp.findRecordsByFilter("worksheet_exercises", `worksheet = "${requestedWorksheetId}"`, "", 0, 0)
        for (const previousExercise of previousExercises) txApp.delete(previousExercise)
      }
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
    console.error("[TeacherHub Action] worksheet draft error:", error)
    const status = Number(error && error.status) || 500
    return e.json(status, { success: false, error: error && error.message || String(error) })
  }
})
