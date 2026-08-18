/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const results = app.findCollectionByNameOrId("homework_results")
  const status = results.fields.getByName("status")
  status.values = ["completed", "needs_review", "reviewed", "returned"]
  results.fields.add(new Field({ name: "teacher_comment", type: "text", max: 5000 }))
  return app.save(results)
}, (app) => {
  const results = app.findCollectionByNameOrId("homework_results")
  const comment = results.fields.getByName("teacher_comment")
  if (comment) results.fields.removeById(comment.id)
  const status = results.fields.getByName("status")
  status.values = ["completed", "needs_review", "reviewed"]
  return app.save(results)
})
