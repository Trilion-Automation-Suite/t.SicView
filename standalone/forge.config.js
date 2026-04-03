const path = require('path');

module.exports = {
  packagerConfig: {
    name: 't.SicView',
    executableName: 't-sicview',
    icon: path.join(__dirname, 'assets', 'icon'),
    asar: false,
    extraResource: [
      // The PyInstaller-bundled server directory
      path.join(__dirname, 'build', 'dist', 'gomsic_server'),
      // README alongside the app
      path.join(__dirname, 'assets', 'README.txt'),
    ],
    // Windows-specific
    win32metadata: {
      CompanyName: 'Trilion Quality Systems',
      FileDescription: 't.SicView - ZEISS Diagnostic Tool',
      ProductName: 't.SicView',
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 't_sicview',
        authors: 'Trilion Quality Systems',
        description: 'Diagnostic viewer for ZEISS Quality Suite support archives',
        setupIcon: path.join(__dirname, 'assets', 'icon.ico'),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin'],
    },
  ],
};
