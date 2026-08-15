/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const worksheets = app.findCollectionByNameOrId("worksheets")
  worksheets.fields.getByName("student").required = false
  worksheets.fields.add(new Field({ name: "level", type: "text", max: 80 }))
  worksheets.fields.add(new Field({ name: "focus", type: "text", max: 500 }))
  worksheets.fields.add(new Field({ name: "estimated_time", type: "text", max: 80 }))
  worksheets.fields.add(new Field({ name: "source_notes", type: "text", max: 4000 }))
  return app.save(worksheets)
}, (app) => {
  const worksheets = app.findCollectionByNameOrId("worksheets")
  for (const name of ["source_notes", "estimated_time", "focus", "level"]) {
    const field = worksheets.fields.getByName(name)
    if (field) worksheets.fields.removeById(field.id)
  }
  worksheets.fields.getByName("student").required = true
  return app.save(worksheets)
})
