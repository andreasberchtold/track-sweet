// Site-wide settings shared by every app in this repository.
//
// googleClientId: the OAuth "Web application" client ID from Google Cloud.
//   It is safe to commit: it only works from the web addresses you
//   authorised for it. While it is empty, every app runs in demo mode and
//   keeps its data in the browser only.
//
// driveFolder: the folder in your Google Drive that holds one JSON file
//   per app (movies.json, health.json, ...). It is created on first use.

export default {
  googleClientId: '',
  driveFolder: 'Personal Apps',
};
