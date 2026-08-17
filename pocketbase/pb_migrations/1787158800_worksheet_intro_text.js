/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const worksheets = app.findCollectionByNameOrId("worksheets")
  worksheets.fields.add(new Field({ name: "intro_text", type: "text", max: 10000 }))
  return app.save(worksheets)
}, (app) => {
  const worksheets = app.findCollectionByNameOrId("worksheets")
  const field = worksheets.fields.getByName("intro_text")
  if (field) worksheets.fields.removeById(field.id)
  return app.save(worksheets)
})
