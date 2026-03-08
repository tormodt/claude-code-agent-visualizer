module.exports = {
  // Absolute path to your projects root directory
  BASE_DIR: '/home/yourname/projects',

  // Prefix used by Claude Code when naming session directories under ~/.claude/projects/
  // Claude encodes paths by replacing slashes/colons/backslashes with dashes, e.g.:
  //   /home/yourname/projects  →  home-yourname-projects
  //   C:\Users\you\projects    →  C--Users-you-projects
  DIR_PREFIX: 'home-yourname-projects',

  // Projects shown in the Deploy dropdown { display label: project directory name }
  PROJECT_MAP: {
    'my-project': 'my-project',
  },
};
