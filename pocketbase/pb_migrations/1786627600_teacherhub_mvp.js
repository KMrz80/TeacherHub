/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")

  if (!users.fields.getByName("name")) {
    users.fields.add(new Field({
      name: "name",
      type: "text",
      max: 120,
    }))
    app.save(users)
  }

  const students = new Collection({
    type: "base",
    name: "students",
    listRule: '@request.auth.role = "teacher" || parent = @request.auth.id',
    viewRule: '@request.auth.role = "teacher" || parent = @request.auth.id',
    createRule: '@request.auth.role = "teacher"',
    updateRule: '@request.auth.role = "teacher"',
    deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "parent", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "course", type: "text", max: 120 },
      { name: "current_topic", type: "text", max: 180 },
      { name: "level", type: "text", max: 30 },
      { name: "avatar_code", type: "text", max: 80 },
    ],
  })
  app.save(students)

  const progress = new Collection({
    type: "base",
    name: "progress",
    listRule: '@request.auth.role = "teacher" || student.parent = @request.auth.id',
    viewRule: '@request.auth.role = "teacher" || student.parent = @request.auth.id',
    createRule: '@request.auth.role = "teacher"',
    updateRule: '@request.auth.role = "teacher"',
    deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "student", type: "relation", required: true, collectionId: students.id, maxSelect: 1 },
      { name: "vocabulary", type: "number", min: 0, max: 100 },
      { name: "grammar", type: "number", min: 0, max: 100 },
      { name: "reading", type: "number", min: 0, max: 100 },
      { name: "listening", type: "number", min: 0, max: 100 },
      { name: "speaking", type: "number", min: 0, max: 100 },
    ],
  })
  app.save(progress)

  const homework = new Collection({
    type: "base",
    name: "homework",
    listRule: '@request.auth.role = "teacher" || (student.parent = @request.auth.id && status = "published")',
    viewRule: '@request.auth.role = "teacher" || (student.parent = @request.auth.id && status = "published")',
    createRule: '@request.auth.role = "teacher"',
    updateRule: '@request.auth.role = "teacher"',
    deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "student", type: "relation", required: true, collectionId: students.id, maxSelect: 1 },
      { name: "title", type: "text", required: true, max: 180 },
      { name: "instructions", type: "text", max: 2000 },
      { name: "due_date", type: "date" },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "published", "completed"] },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
    ],
  })
  app.save(homework)

  const tasks = new Collection({
    type: "base",
    name: "homework_tasks",
    listRule: '@request.auth.role = "teacher" || (homework.student.parent = @request.auth.id && homework.status = "published")',
    viewRule: '@request.auth.role = "teacher" || (homework.student.parent = @request.auth.id && homework.status = "published")',
    createRule: '@request.auth.role = "teacher"',
    updateRule: '@request.auth.role = "teacher"',
    deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "homework", type: "relation", required: true, collectionId: homework.id, maxSelect: 1 },
      { name: "question", type: "text", required: true, max: 1000 },
      { name: "task_type", type: "select", maxSelect: 1, values: ["multiple_choice", "text_input"] },
      { name: "options", type: "json", maxSize: 20000 },
      { name: "correct_answer", type: "text", max: 500 },
      { name: "order", type: "number", min: 0 },
    ],
  })
  app.save(tasks)

  const results = new Collection({
    type: "base",
    name: "homework_results",
    listRule: '@request.auth.role = "teacher" || student.parent = @request.auth.id',
    viewRule: '@request.auth.role = "teacher" || student.parent = @request.auth.id',
    createRule: 'student.parent = @request.auth.id && homework.student = student && homework.status = "published"',
    updateRule: 'student.parent = @request.auth.id && homework.student = student && homework.status = "published"',
    deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "homework", type: "relation", required: true, collectionId: homework.id, maxSelect: 1 },
      { name: "student", type: "relation", required: true, collectionId: students.id, maxSelect: 1 },
      { name: "score", type: "number", min: 0 },
      { name: "max_score", type: "number", min: 0 },
      { name: "percentage", type: "number", min: 0, max: 100 },
      { name: "completed_at", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_homework_results_unique ON homework_results (homework, student)",
    ],
  })
  app.save(results)
}, (app) => {
  for (const name of ["homework_results", "homework_tasks", "homework", "progress", "students"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name))
    } catch (_) {}
  }
})
