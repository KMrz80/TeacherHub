/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const results = app.findCollectionByNameOrId("homework_results")
  results.updateRule = '@request.auth.role = "teacher" || (student.parent = @request.auth.id && homework.student = student && homework.status = "published")'
  return app.save(results)
}, (app) => {
  const results = app.findCollectionByNameOrId("homework_results")
  results.updateRule = 'student.parent = @request.auth.id && homework.student = student && homework.status = "published"'
  return app.save(results)
})
