/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const sources = app.findCollectionByNameOrId("worksheet_sources")
  sources.fields.add(new Field({ name: "metadata", type: "json", maxSize: 20000 }))
  return app.save(sources)
}, (app) => {
  const sources = app.findCollectionByNameOrId("worksheet_sources")
  const field = sources.fields.getByName("metadata")
  if (field) sources.fields.removeById(field.id)
  return app.save(sources)
})
