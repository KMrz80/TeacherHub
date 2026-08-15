# TeacherHub

## Локальный запуск

```powershell
cd C:\MyProjects\TecherHub
.\pocketbase\pocketbase.exe serve --http=127.0.0.1:8090 --dir=.\pocketbase\pb_data --migrationsDir=.\pocketbase\pb_migrations --hooksDir=.\pb_hooks --publicDir=.
```

## Custom GPT Action endpoint

Endpoint создаёт worksheet и связанные `worksheet_exercises` только со статусом `draft`:

```text
POST http://127.0.0.1:8090/api/teacherhub/worksheet-drafts
```

Обязательный заголовок:

```text
Authorization: Bearer <TEACHERHUB_ACTION_KEY>
```

Перед запуском PocketBase задайте отдельный секретный ключ:

```powershell
$env:TEACHERHUB_ACTION_KEY = "replace-with-a-long-random-secret"
```

Не сохраняйте этот ключ во frontend или `app.js`. В текущем MVP должен существовать ровно один пользователь с ролью `teacher`, которому будет принадлежать импортированный draft. `student_id` можно передать как ID существующего ученика или `null` для draft без назначенного ученика.

Пример запроса:

```powershell
curl.exe -X POST "http://127.0.0.1:8090/api/teacherhub/worksheet-drafts" -H "Authorization: Bearer $env:TEACHERHUB_ACTION_KEY" -H "Content-Type: application/json" --data-raw '{"title":"Past Simple review","learning_goal":"Practise Past Simple irregular verbs","level":"A2","focus":"Irregular verbs","estimated_time":"15 minutes","student_id":null,"source_notes":"Approved by teacher","exercises":[{"type":"multiple_choice","instruction":"Choose the correct form.","order":1,"points":1,"content":{"options":["go","went","gone"],"correct_answer":["went"]}}]}'
```

Успешный ответ:

```json
{
  "success": true,
  "worksheet_id": "RECORD_ID",
  "status": "draft"
}
```

Ответ при ошибке:

```json
{
  "success": false,
  "error": "Описание ошибки"
}
```
