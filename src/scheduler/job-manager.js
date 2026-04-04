'use strict';

const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { runScript } = require('./runner');

const SCRIPTS_DIR = path.join(__dirname, '../../scripts');
const scheduledTasks = new Map(); // scriptName -> cron task

function loadScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];

  return fs.readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => {
      const scriptPath = path.join(SCRIPTS_DIR, f);
      try {
        delete require.cache[require.resolve(scriptPath)];
        const mod = require(scriptPath);
        return {
          name: mod.name || path.basename(f, '.js'),
          file: f,
          path: scriptPath,
          cron: mod.cron || null,
          description: mod.description || '',
          outputPath: mod.outputPath || null,
        };
      } catch (err) {
        return {
          name: path.basename(f, '.js'),
          file: f,
          path: scriptPath,
          cron: null,
          error: err.message,
        };
      }
    });
}

function startScheduler(log) {
  const scripts = loadScripts();

  for (const script of scripts) {
    if (!script.cron) continue;
    if (!cron.validate(script.cron)) {
      log?.warn(`Invalid cron expression for ${script.name}: ${script.cron}`);
      continue;
    }

    // Stop existing task if reloading
    if (scheduledTasks.has(script.name)) {
      scheduledTasks.get(script.name).stop();
    }

    const task = cron.schedule(script.cron, async () => {
      log?.info(`Running scheduled job: ${script.name}`);
      const result = await runScript(script.path, 'cron');
      if (!result.success) {
        log?.error(`Job ${script.name} failed: ${result.error}`);
      }
    });

    scheduledTasks.set(script.name, task);
    log?.info(`Scheduled job: ${script.name} (${script.cron})`);
  }
}

function stopScheduler() {
  for (const task of scheduledTasks.values()) task.stop();
  scheduledTasks.clear();
}

module.exports = { loadScripts, startScheduler, stopScheduler };
