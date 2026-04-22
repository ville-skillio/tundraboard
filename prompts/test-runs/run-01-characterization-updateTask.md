# Test Run 01 — Template 03: Characterisation Tests for `updateTask`

## Template used
`prompts/testing/03-characterization-tests.md`

## Filled-in prompt

```
You are writing characterisation tests for a legacy Node.js service.
Characterisation tests capture what code *currently does*, not what it *should* do.
If the code has a bug, capture the buggy behaviour — do not fix it in the test.

Here is the existing test file setup and one example test block for style reference:

Mock setup:

    jest.mock('../src/db');
    const db = require('../src/db');
    const taskService = require('../src/services/taskService');

    beforeEach(() => {
      jest.clearAllMocks();
    });

Example test block (follow this exact style — describe/it structure, done callbacks
for async, mockImplementationOnce chaining for multiple db calls):

    describe('createTask', () => {
      it('inserts the task and returns the created row', (done) => {
        const created = { id: 'new-task', title: 'New task', status: 'todo' };
        db.query.mockImplementationOnce((_sql, cb) =>
          cb(null, { rows: [created] })
        );
        taskService.createTask(
          { title: 'New task', projectId: 'proj-1', createdById: 'user-1' },
          (err, task) => {
            expect(err).toBeNull();
            expect(task).toEqual(created);
            done();
          }
        );
      });
    });

Function to test (updateTask):

    function updateTask(taskId, updates, callback) {
      var setClauses = [];
      var keys = Object.keys(updates);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = updates[key];
        if (value === null) {
          setClauses.push(key + " = NULL");
        } else {
          setClauses.push(key + " = '" + value + "'");
        }
      }
      setClauses.push("updated_at = NOW()");
      var query = "UPDATE tasks SET " + setClauses.join(', ') + " WHERE id = '" + taskId + "' RETURNING *";
      db.query(query, function(err, result) {
        if (err) {
          callback(err, null);
          return;
        }
        if (result.rows.length === 0) {
          callback(new Error('Task not found'), null);
          return;
        }
        callback(null, result.rows[0]);
      });
    }

This function makes 1 db.query call.

Write a describe('updateTask', ...) block covering:
1. The happy path — mock all db calls to succeed, assert on the return value shape
2. Each distinct error path — one test per db.query call that can fail
3. Any conditional branches (e.g., "when X is null", "when result is empty")

Rules:
- Use mockImplementationOnce not mockResolvedValueOnce — the legacy code uses
  callbacks, not Promises.
- Each test must call done() at the end of its callback.
- Do not assert on SQL string content unless the test is specifically about query
  construction.
- Copy beforeEach(() => { jest.clearAllMocks(); }) is already in the file — do
  not add it again.
```

---

## AI Output

```javascript
describe('updateTask', () => {
  it('returns the updated task row on success', (done) => {
    const updated = { id: 'task-1', title: 'Updated title', status: 'in_progress' };
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [updated] })
    );

    taskService.updateTask('task-1', { title: 'Updated title', status: 'in_progress' }, (err, task) => {
      expect(err).toBeNull();
      expect(task).toEqual(updated);
      done();
    });
  });

  it('returns an error when the task does not exist', (done) => {
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [] })
    );

    taskService.updateTask('nonexistent', { title: 'x' }, (err, task) => {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Task not found');
      expect(task).toBeNull();
      done();
    });
  });

  it('propagates a database error', (done) => {
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(new Error('update failed'), null)
    );

    taskService.updateTask('task-1', { title: 'x' }, (err, task) => {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('update failed');
      expect(task).toBeNull();
      done();
    });
  });

  it('sets a field to NULL when the update value is null', (done) => {
    const updated = { id: 'task-1', title: 'task', assignee_id: null };
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [updated] })
    );

    taskService.updateTask('task-1', { assignee_id: null }, (err, task) => {
      expect(err).toBeNull();
      expect(task.assignee_id).toBeNull();
      done();
    });
  });
});
```

---

## Applying the output

The generated block was added to `tests/taskService.characterization.test.js` and
the test suite run immediately:

```
Tests: 15 passed, 15 total
```

All four new tests passed on the first run with no adjustments.

---

## Quality Assessment

**What worked well:**
- The few-shot example was decisive. The AI matched the `done`-callback style,
  `mockImplementationOnce` chaining, and `(err, task)` callback assertion pattern
  exactly — no `async/await` style drift.
- Correctly identified both error branches: database error AND empty result. Some
  AI responses miss the empty-result branch and only test the db error path.
- The `null` value branch test (setting `assignee_id` to `null`) was generated
  without being explicitly requested — the AI read the `value === null` branch in
  the source code and produced a test for it.

**What to adjust:**
- The template prompt says "do not assert on SQL string content" but the null-value
  test would be stronger if it *did* verify the SQL contains `assignee_id = NULL`
  (not `assignee_id = 'null'`). This is a case where the default instruction
  is too conservative. Add an optional `{{ASSERT_SQL}}` variable (true/false) to
  the template to allow SQL assertion tests when the function's primary logic is
  query construction.
- The template does not prompt for a test covering an empty `updates` object
  `{}`. The function would produce `UPDATE tasks SET updated_at = NOW() WHERE id = ...`
  which is valid SQL but likely unintended. That edge case is worth capturing.
