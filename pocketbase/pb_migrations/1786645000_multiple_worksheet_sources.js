/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const sources = app.findCollectionByNameOrId("worksheet_sources")
  const materials = app.findCollectionByNameOrId("materials")
  const oldFile = sources.fields.getByName("file")
  if (oldFile) oldFile.required = false
  sources.fields.add(new Field({ name: "material", type: "relation", collectionId: materials.id, maxSelect: 1 }))
  sources.fields.add(new Field({ name: "uploaded_file", type: "file", maxSelect: 1, maxSize: 52428800, mimeTypes: ["image/jpeg", "image/png", "application/pdf"] }))
  sources.fields.add(new Field({ name: "source_type", type: "select", required: true, maxSelect: 1, values: ["library", "upload"] }))
  return app.save(sources)
}, (app) => {
  const sources = app.findCollectionByNameOrId("worksheet_sources")
  for (const name of ["source_type", "uploaded_file", "material"]) {
    const field = sources.fields.getByName(name); if (field) sources.fields.removeById(field.id)
  }
  const oldFile = sources.fields.getByName("file"); if (oldFile) oldFile.required = true
  return app.save(sources)
})
