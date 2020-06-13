/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';
import spawn from 'cross-spawn';

export const IS_WINDOWS = process.platform.startsWith('win');

/**
 * Returns system type in a format compatible with PIO Core get_systypy()
 */
export function getSysType() {
  const js2python = {
    win32_x64: 'windows_amd64',
    win32_x32: 'windows_x86',
    win32_ia32: 'windows_x86',
    darwin_x64: 'darwin_x86_64',
    darwin_x32: 'darwin_i686',
    linux_x64: 'linux_x86_64',
    linux_x32: 'linux_i686',
    linux_arm: 'linux_armv6l',
    linux_arm64: 'linux_aarch64',
    freebsd_x64: 'freebsd_amd64'
  };
  const result = `${process.platform}_${process.arch}`;
  return js2python[result] || result;
}

export function patchOSEnviron({ caller, extraPath, extraVars }) {
  process.env.PLATFORMIO_CALLER = caller;
  // Fix for platformio-atom-ide/issues/112
  if (process.platform === 'darwin') {
    process.env.LC_ALL = 'en_US.UTF-8';
  }
  if (caller === 'atom') {
    process.env.PLATFORMIO_DISABLE_PROGRESSBAR = 'true';
  }

  if (extraVars) {
    Object.keys(extraVars).forEach(name => (process.env[name] = extraVars[name]));
  }

  // Fix for https://github.com/atom/atom/issues/11302
  if (process.env.Path) {
    if (process.env.PATH) {
      process.env.PATH += path.delimiter + process.env.Path;
    } else {
      process.env.PATH = process.env.Path;
    }
  }

  if (extraPath) {
    extendOSEnvironPath(extraPath.split(path.delimiter));
  }

  // Expand Windows environment variables in %xxx% format
  const reWindowsEnvVar = /\%([^\%]+)\%/g;
  while (IS_WINDOWS && reWindowsEnvVar.test(process.env.PATH)) {
    process.env.PATH = process.env.PATH.replace(reWindowsEnvVar, (_, envvar) => {
      return process.env[envvar] || '';
    });
  }

  // copy PATH to Path (Windows issue)
  if (process.env.Path) {
    process.env.Path = process.env.PATH;
  }

  // Configure NO_PROXY for PIO Home
  process.env.NO_PROXY =
    '127.0.0.1' + (process.env.NO_PROXY ? `,${process.env.NO_PROXY}` : '');
}

export function extendOSEnvironPath(items, prepend = true) {
  items.reverse().forEach(item => {
    if (!process.env.PATH.includes(item)) {
      process.env.PATH = (prepend
        ? [item, process.env.PATH]
        : [process.env.PATH, item]
      ).join(path.delimiter);
    }
  });
  // copy PATH to Path (Windows issue)
  if (process.env.Path) {
    process.env.Path = process.env.PATH;
  }
}

export function runCommand(cmd, args, callback = undefined, options = {}) {
  console.info('runCommand', cmd, args, options);
  const outputLines = [];
  const errorLines = [];
  let completed = false;
  options = options || {};

  try {
    const child = spawn(cmd, args, options.spawnOptions);
    child.stdout.on('data', line => outputLines.push(line));
    child.stderr.on('data', line => errorLines.push(line));
    child.on('close', onExit);
    child.on('error', err => {
      errorLines.push(err.toString());
      onExit(-1);
    });
  } catch (err) {
    errorLines.push(err.toString());
    onExit(-1);
  }

  function onExit(code) {
    if (completed || !callback) {
      return;
    }
    completed = true;

    const stdout = outputLines.map(x => x.toString()).join('');
    const stderr = errorLines.map(x => x.toString()).join('');
    callback(code, stdout, stderr);
  }
}

export function getCommandOutput(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    runCommand(
      cmd,
      args,
      (code, stdout, stderr) => {
        if (code === 0) {
          return resolve(stdout);
        } else {
          const errMessage = stdout ? `${stderr} -> ${stdout}` : stderr;
          const err = new Error(errMessage);
          err.stderr = stderr;
          err.stdout = stdout;
          return reject(err);
        }
      },
      options
    );
  });
}

export async function findPythonExecutable(options = {}) {
  const exenames = IS_WINDOWS ? ['python.exe'] : ['python3', 'python', 'python2'];
  const pythonAssertCode = [
    'import sys',
    'assert sys.version_info >= (2, 7)',
    'print(sys.executable)'
  ];
  if (options.pioCoreSpec) {
    pythonAssertCode.push('import semantic_version');
    pythonAssertCode.push('from platformio import __version__, util');
    pythonAssertCode.push(
      `assert semantic_version.Version(util.pepver_to_semver(__version__)) in semantic_version.Spec("${options.pioCoreSpec}")`
    );
  }
  for (const location of process.env.PATH.split(path.delimiter)) {
    for (const exename of exenames) {
      const executable = path.normalize(path.join(location, exename)).replace(/"/g, '');
      try {
        if (
          fs.existsSync(executable) &&
          (await getCommandOutput(executable, ['-c', pythonAssertCode.join(';')]))
        ) {
          return executable;
        }
      } catch (err) {
        console.warn(executable, err);
      }
    }
  }
  return null;
}

export function whereIsProgram(program) {
  for (const location of process.env.PATH.split(path.delimiter)) {
    const executable = path.normalize(path.join(location, program)).replace(/"/g, '');
    try {
      if (fs.existsSync(executable)) {
        return executable;
      }
    } catch (err) {}
  }
  return null;
}
