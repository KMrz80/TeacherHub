/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const exercises = app.findCollectionByNameOrId("worksheet_exercises")
  const type = exercises.fields.getByName("type")
  type.values = ["multiple_choice", "text_input", "reorder_words", "matching", "dropdown", "drag_drop", "open_text_teacher_review", "video_embed", "embed"]
  app.save(exercises)

  const results = app.findCollectionByNameOrId("homework_results")
  results.fields.add(new Field({ name: "status", type: "select", maxSelect: 1, values: ["completed", "needs_review", "reviewed"] }))
  results.fields.add(new Field({ name: "open_answers", type: "json", maxSize: 50000 }))
  return app.save(results)
}, (app) => {
  const results = app.findCollectionByNameOrId("homework_results")
  for (const name of ["open_answers", "status"]) {
    const field = results.fields.getByName(name)
    if (field) results.fields.removeById(field.id)
  }
  app.save(results)

  const exercises = app.findCollectionByNameOrId("worksheet_exercises")
  const type = exercises.fields.getByName("type")
  type.values = ["multiple_choice", "text_input", "reorder_words", "matching", "dropdown", "video_embed", "embed"]
  return app.save(exercises)
})
