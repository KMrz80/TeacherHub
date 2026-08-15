/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const exercises = app.findCollectionByNameOrId("worksheet_exercises")
  const type = exercises.fields.getByName("type")
  type.values = ["multiple_choice", "text_input", "reorder_words", "matching", "video_embed", "embed"]
  exercises.fields.add(new Field({ name: "title", type: "text", max: 180 }))
  exercises.fields.add(new Field({ name: "embed_url", type: "url", exceptDomains: [] }))
  return app.save(exercises)
}, (app) => {
  const exercises = app.findCollectionByNameOrId("worksheet_exercises")
  for (const name of ["embed_url", "title"]) {
    const field = exercises.fields.getByName(name); if (field) exercises.fields.removeById(field.id)
  }
  const type = exercises.fields.getByName("type")
  type.values = ["multiple_choice", "text_input", "reorder_words", "matching"]
  return app.save(exercises)
})
