/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const exercises = app.findCollectionByNameOrId("worksheet_exercises")
  const type = exercises.fields.getByName("type")
  type.values = ["multiple_choice", "text_input", "reorder_words", "matching", "dropdown", "video_embed", "embed"]
  return app.save(exercises)
}, (app) => {
  const exercises = app.findCollectionByNameOrId("worksheet_exercises")
  const type = exercises.fields.getByName("type")
  type.values = ["multiple_choice", "text_input", "reorder_words", "matching", "video_embed", "embed"]
  return app.save(exercises)
})
