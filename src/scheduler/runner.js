'use strict';

const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');

const DEFAULT_OUTPUT_DIR = path.join(__dirname, '../../output');

function createQueryHelper() {
  const db = getDb();
  return function query(sql, params = []) {
    return db.prepare(sql).all(...params);
  };
}

async function runScript(scriptPath, triggeredBy = 'manual') {
  const db = getDb();
  const scriptName = path.basename(scriptPath, '.js');
  const logs = [];

  const insertRun = db.prepare(`
    INSERT INTO job_runs (script_name, triggered_by, status)
    VALUES (?, ?, 'running')
  `);
  const runId = insertRun.run(scriptName, triggeredBy).lastInsertRowid;

  const outputFiles = [];

  try {
    // Delete require cache so hot-reload works (needed before reading outputPath)
    delete require.cache[require.resolve(scriptPath)];
    const script = require(scriptPath);

    const outputDir = script.outputPath
      ? path.resolve(script.outputPath)
      : DEFAULT_OUTPUT_DIR;

    const helpers = {
      outputDir,
      // Write to the job's configured output directory (filename only, no path separators)
      writeFile(filename, content) {
        const filePath = path.join(outputDir, path.basename(filename));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        outputFiles.push(filePath);
        logs.push(`Written: ${filePath}`);
      },
      // Write to an arbitrary absolute path on the system
      writeFileTo(absolutePath, content) {
        const resolved = path.resolve(absolutePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content, 'utf8');
        outputFiles.push(resolved);
        logs.push(`Written: ${resolved}`);
      },
      log(msg) {
        logs.push(String(msg));
      },
    };

    const query = createQueryHelper();

    await script.run(query, helpers);

    db.prepare(`
      UPDATE job_runs
      SET status = 'success', output_files = ?, logs = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(outputFiles), JSON.stringify(logs), runId);

    return { success: true, logs, outputFiles, runId };
  } catch (err) {
    db.prepare(`
      UPDATE job_runs
      SET status = 'error', error = ?, logs = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(err.message, JSON.stringify(logs), runId);

    return { success: false, error: err.message, logs, runId };
  }
}

module.exports = { runScript };
