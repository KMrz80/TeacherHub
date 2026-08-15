/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const students = app.findCollectionByNameOrId("students")
  const homework = app.findCollectionByNameOrId("homework")

  const materials = new Collection({
    type: "base", name: "materials",
    listRule: '@request.auth.role = "teacher" && created_by = @request.auth.id',
    viewRule: '@request.auth.role = "teacher" && created_by = @request.auth.id',
    createRule: '@request.auth.role = "teacher" && @request.body.created_by = @request.auth.id',
    updateRule: '@request.auth.role = "teacher" && created_by = @request.auth.id',
    deleteRule: '@request.auth.role = "teacher" && created_by = @request.auth.id',
    fields: [
      { name: "title", type: "text", required: true, max: 180 },
      { name: "publisher", type: "text", max: 180 },
      { name: "description", type: "text", max: 2000 },
      { name: "cover", type: "file", maxSelect: 1, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { name: "file", type: "file", maxSelect: 1, maxSize: 52428800 },
      { name: "created_by", type: "relation", required: true, collectionId: users.id, maxSelect: 1 },
    ],
  }); app.save(materials)

  const sections = new Collection({
    type: "base", name: "material_sections",
    listRule: '@request.auth.role = "teacher" && material.created_by = @request.auth.id',
    viewRule: '@request.auth.role = "teacher" && material.created_by = @request.auth.id',
    createRule: '@request.auth.role = "teacher" && material.created_by = @request.auth.id',
    updateRule: '@request.auth.role = "teacher" && material.created_by = @request.auth.id',
    deleteRule: '@request.auth.role = "teacher" && material.created_by = @request.auth.id',
    fields: [
      { name: "material", type: "relation", required: true, collectionId: materials.id, maxSelect: 1 },
      { name: "title", type: "text", required: true, max: 180 },
      { name: "unit", type: "text", max: 100 },
      { name: "page_from", type: "number", min: 0 }, { name: "page_to", type: "number", min: 0 },
      { name: "order", type: "number", min: 0 },
    ],
  }); app.save(sections)

  const worksheets = new Collection({
    type: "base", name: "worksheets",
    listRule: '@request.auth.role = "teacher" || (student.parent = @request.auth.id && status = "published")',
    viewRule: '@request.auth.role = "teacher" || (student.parent = @request.auth.id && status = "published")',
    createRule: '@request.auth.role = "teacher"', updateRule: '@request.auth.role = "teacher"', deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "student", type: "relation", required: true, collectionId: students.id, maxSelect: 1 },
      { name: "title", type: "text", required: true, max: 180 }, { name: "instructions", type: "text", max: 2000 },
      { name: "source_material", type: "relation", collectionId: materials.id, maxSelect: 1 },
      { name: "source_section", type: "relation", collectionId: sections.id, maxSelect: 1 },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "published"] },
      { name: "due_date", type: "date" },
      { name: "created_by", type: "relation", required: true, collectionId: users.id, maxSelect: 1 },
    ],
  }); app.save(worksheets)

  const sources = new Collection({
    type: "base", name: "worksheet_sources",
    listRule: '@request.auth.role = "teacher" && worksheet.created_by = @request.auth.id',
    viewRule: '@request.auth.role = "teacher" && worksheet.created_by = @request.auth.id',
    createRule: '@request.auth.role = "teacher" && worksheet.created_by = @request.auth.id',
    updateRule: '@request.auth.role = "teacher" && worksheet.created_by = @request.auth.id',
    deleteRule: '@request.auth.role = "teacher" && worksheet.created_by = @request.auth.id',
    fields: [
      { name: "worksheet", type: "relation", required: true, collectionId: worksheets.id, maxSelect: 1 },
      { name: "file", type: "file", required: true, maxSelect: 1, maxSize: 52428800, mimeTypes: ["image/jpeg", "image/png", "application/pdf"] },
      { name: "order", type: "number", min: 0 },
    ],
  }); app.save(sources)

  const exercises = new Collection({
    type: "base", name: "worksheet_exercises",
    listRule: '@request.auth.role = "teacher" || (worksheet.student.parent = @request.auth.id && worksheet.status = "published")',
    viewRule: '@request.auth.role = "teacher" || (worksheet.student.parent = @request.auth.id && worksheet.status = "published")',
    createRule: '@request.auth.role = "teacher"', updateRule: '@request.auth.role = "teacher"', deleteRule: '@request.auth.role = "teacher"',
    fields: [
      { name: "worksheet", type: "relation", required: true, collectionId: worksheets.id, maxSelect: 1 },
      { name: "type", type: "select", required: true, maxSelect: 1, values: ["multiple_choice", "text_input", "reorder_words", "matching"] },
      { name: "instruction", type: "text", required: true, max: 1000 },
      { name: "content", type: "json", maxSize: 50000 }, { name: "correct_answer", type: "json", maxSize: 50000 },
      { name: "order", type: "number", min: 0 }, { name: "points", type: "number", min: 0 },
    ],
  }); app.save(exercises)

  homework.fields.add(new Field({ name: "worksheet", type: "relation", collectionId: worksheets.id, maxSelect: 1 }))
  app.save(homework)
}, (app) => {
  const homework = app.findCollectionByNameOrId("homework")
  const field = homework.fields.getByName("worksheet"); if (field) { homework.fields.removeById(field.id); app.save(homework) }
  for (const name of ["worksheet_exercises", "worksheet_sources", "worksheets", "material_sections", "materials"]) {
    try { app.delete(app.findCollectionByNameOrId(name)) } catch (_) {}
  }
})
