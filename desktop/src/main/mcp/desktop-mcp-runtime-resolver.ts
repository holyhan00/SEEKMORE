import { constants as fsConstants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

export type DesktopMcpRuntimeResolverOptions = {
  packaged: boolean;
  resourcesPath: string;
  appPath?: string;
  homePath: string;
  platform: NodeJS.Platform;
  arch: string;
  environment: NodeJS.ProcessEnv;
};


export type DesktopMcpRuntimeInvocation = {
  command: string;
  args: string[];
};

type ManagedNodeCommand =
  | 'node'
  | 'npm'
  | 'npx'
  | 'corepack';

const MANAGED_NODE_COMMANDS = new Set<ManagedNodeCommand>([
  'node',
  'npm',
  'npx',
  'corepack',
]);

export class DesktopMcpRuntimeResolver {
  constructor(
    private readonly options: DesktopMcpRuntimeResolverOptions,
  ) {}

  async resolveExecutable(
    requestedCommand: string,
  ): Promise<string> {
    const containsPath =
      path.isAbsolute(requestedCommand)
      || requestedCommand.includes('/')
      || requestedCommand.includes('\\');

    if (containsPath) {
      return this.resolveExplicitExecutable(
        requestedCommand,
      );
    }

    const managedName =
      this.managedCommandName(
        requestedCommand,
      );

    if (
      this.options.packaged
      && managedName
    ) {
      const executable =
        this.managedExecutablePath(
          managedName,
        );

      try {
        await access(
          executable,
          this.options.platform === 'win32'
            ? fsConstants.F_OK
            : fsConstants.X_OK,
        );
      } catch {
        throw this.error(
          'MCP_STDIO_MANAGED_RUNTIME_MISSING',
          `SEEKMORE managed runtime executable is missing: ${managedName}`,
        );
      }

      // Preserve the bundled launcher path itself. npm/npx/corepack may be
      // symlinks or scripts whose shebang must resolve through SEEKMORE's
      // managed PATH instead of the user's system Node installation.
      return executable;
    }

    return this.resolveSystemExecutable(
      requestedCommand,
    );
  }

  async resolveInvocation(
    requestedCommand: string,
    args: readonly string[],
  ): Promise<DesktopMcpRuntimeInvocation> {
    const managedName = this.managedCommandName(requestedCommand);

    if (
      this.options.packaged
      && this.options.platform === 'win32'
      && managedName
      && managedName !== 'node'
    ) {
      const nodeExecutable = this.managedExecutablePath('node');
      const cliEntry = this.managedNodeCliEntryPath(managedName);

      try {
        await Promise.all([
          access(nodeExecutable, fsConstants.F_OK),
          access(cliEntry, fsConstants.F_OK),
        ]);
      } catch {
        throw this.error(
          'MCP_STDIO_MANAGED_RUNTIME_MISSING',
          `SEEKMORE managed runtime executable is missing: ${managedName}`,
        );
      }

      return {
        command: nodeExecutable,
        args: [cliEntry, ...args],
      };
    }

    const executable = await this.resolveExecutable(requestedCommand);
    if (
      this.options.platform === 'win32'
      && /\.(cmd|bat)$/i.test(executable)
    ) {
      return {
        command: String(
          this.options.environment.ComSpec
          ?? this.options.environment.COMSPEC
          ?? 'cmd.exe',
        ),
        args: ['/d', '/s', '/c', executable, ...args],
      };
    }

    return {
      command: executable,
      args: [...args],
    };
  }

  cleanEnvironment(
    explicit: Record<string, string>,
  ): Record<string, string> {
    const baselineKeys =
      this.options.platform === 'win32'
        ? [
            'PATH',
            'Path',
            'SystemRoot',
            'TEMP',
            'TMP',
            'USERPROFILE',
            'APPDATA',
            'LOCALAPPDATA',
          ]
        : [
            'PATH',
            'HOME',
            'TMPDIR',
            'LANG',
            'LC_ALL',
            'USER',
          ];

    const protectedKeys = new Set(
      baselineKeys.map(
        (key) => key.toLowerCase(),
      ),
    );

    const baseline = Object.fromEntries(
      baselineKeys
        .map(
          (key) => [
            key,
            this.options.environment[key],
          ] as const,
        )
        .filter(
          (
            entry,
          ): entry is readonly [
            string,
            string,
          ] => Boolean(entry[1]),
        ),
    );

    const allowedExplicit = Object.fromEntries(
      Object.entries(
        explicit,
      ).filter(
        ([key]) =>
          !protectedKeys.has(
            key.toLowerCase(),
          ),
      ),
    );

    const environment: Record<string, string> = {
      ...baseline,
      ...allowedExplicit,
    };

    if (this.options.packaged) {
      const runtimeBin =
        this.managedNodeBinRoot();

      const existingPath = String(
        this.options.environment.PATH
        ?? this.options.environment.Path
        ?? '',
      );

      const nextPath =
        this.mergePath(
          runtimeBin,
          existingPath,
        );

      if (
        this.options.platform === 'win32'
      ) {
        environment.Path = nextPath;
        environment.PATH = nextPath;
      } else {
        environment.PATH = nextPath;
      }
    }

    return environment;
  }

  private managedCommandName(
    command: string,
  ): ManagedNodeCommand | null {
    const clean =
      command.trim().toLowerCase();

    const withoutExtension =
      clean.replace(
        /\.(exe|cmd)$/i,
        '',
      );

    return MANAGED_NODE_COMMANDS.has(
      withoutExtension as ManagedNodeCommand,
    )
      ? withoutExtension as ManagedNodeCommand
      : null;
  }

  private managedNodeBinRoot(): string {
    if (
      this.options.platform === 'win32'
    ) {
      return path.join(
        this.options.resourcesPath,
        'runtime',
        'node',
      );
    }

    return path.join(
      this.options.resourcesPath,
      'runtime',
      'node',
      'bin',
    );
  }

  private managedExecutablePath(
    command: ManagedNodeCommand,
  ): string {
    const root =
      this.managedNodeBinRoot();

    if (
      this.options.platform !== 'win32'
    ) {
      return path.join(
        root,
        command,
      );
    }

    if (command === 'node') {
      return path.join(
        root,
        'node.exe',
      );
    }

    return path.join(
      root,
      `${command}.cmd`,
    );
  }

  private managedNodeCliEntryPath(
    command: Exclude<ManagedNodeCommand, 'node'>,
  ): string {
    const root = this.options.platform === 'win32'
      ? path.join(this.options.resourcesPath, 'runtime', 'node')
      : path.join(this.options.resourcesPath, 'runtime', 'node', 'lib');

    if (command === 'npm') {
      return path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    }

    if (command === 'npx') {
      return path.join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    }

    return path.join(root, 'node_modules', 'corepack', 'dist', 'corepack.js');
  }

  private async resolveExplicitExecutable(
    requestedCommand: string,
  ): Promise<string> {
    const candidate =
      path.resolve(
        requestedCommand,
      );

    try {
      await access(
        candidate,
        this.options.platform === 'win32'
          ? fsConstants.F_OK
          : fsConstants.X_OK,
      );

      return await realpath(
        candidate,
      ).catch(
        () => candidate,
      );
    } catch {
      throw this.error(
        'MCP_STDIO_COMMAND_NOT_FOUND',
        `The MCP executable could not be found: ${requestedCommand}`,
      );
    }
  }

  private async resolveSystemExecutable(
    requestedCommand: string,
  ): Promise<string> {
    const executableNames =
      this.options.platform === 'win32'
      && !path.extname(
        requestedCommand,
      )
        ? [
            requestedCommand,
            `${requestedCommand}.exe`,
            `${requestedCommand}.cmd`,
          ]
        : [
            requestedCommand,
          ];

    const systemPath = String(
      this.options.environment.PATH
      ?? this.options.environment.Path
      ?? '',
    )
      .split(path.delimiter)
      .map(
        (entry) => entry.trim(),
      )
      .filter(Boolean);

    // Preserve the previous Desktop Host search roots for non-managed
    // commands. This change only redirects node/npm/npx/corepack when the
    // application is packaged.
    const desktopResourceBins = [
      path.join(
        this.options.resourcesPath,
        'bin',
        this.options.platform,
        this.options.arch,
      ),
      path.join(
        this.options.resourcesPath,
        'bin',
      ),
      ...(
        this.options.appPath
          ? [
              path.join(
                this.options.appPath,
                'resources',
                'bin',
                this.options.platform,
                this.options.arch,
              ),
              path.join(
                this.options.appPath,
                'resources',
                'bin',
              ),
            ]
          : []
      ),
    ];

    const directories = [
      ...systemPath,
      ...desktopResourceBins,
      path.join(
        this.options.homePath,
        '.local',
        'bin',
      ),
      path.join(
        this.options.homePath,
        '.cargo',
        'bin',
      ),
      ...(
        this.options.platform === 'darwin'
          ? [
              '/opt/homebrew/bin',
              '/usr/local/bin',
              '/usr/bin',
              '/bin',
            ]
          : this.options.platform === 'win32'
            ? [
                path.join(
                  this.options.homePath,
                  '.local',
                  'bin',
                ),
                String(
                  this.options.environment.LOCALAPPDATA
                  ?? '',
                ),
              ].filter(Boolean)
            : [
                '/usr/local/bin',
                '/usr/bin',
                '/bin',
              ]
      ),
    ];

    const uniqueDirectories = [
      ...new Set(
        directories.filter(Boolean),
      ),
    ];

    for (
      const directory
      of uniqueDirectories
    ) {
      for (
        const executableName
        of executableNames
      ) {
        const candidate = path.join(
          directory,
          executableName,
        );

        try {
          await access(
            candidate,
            this.options.platform === 'win32'
              ? fsConstants.F_OK
              : fsConstants.X_OK,
          );

          return await realpath(
            candidate,
          ).catch(
            () => candidate,
          );
        } catch {
          // Continue deterministic search.
        }
      }
    }

    throw this.error(
      'MCP_STDIO_COMMAND_NOT_FOUND',
      `The MCP executable could not be found: ${requestedCommand}`,
    );
  }

  private mergePath(
    first: string,
    existing: string,
  ): string {
    const values = [
      first,
      ...existing.split(
        path.delimiter,
      ),
    ]
      .map(
        (entry) => entry.trim(),
      )
      .filter(Boolean);

    return [
      ...new Set(values),
    ].join(
      path.delimiter,
    );
  }

  private error(
    code: string,
    message: string,
  ): Error & {
    code: string;
  } {
    return Object.assign(
      new Error(message),
      {
        code,
      },
    );
  }
}
