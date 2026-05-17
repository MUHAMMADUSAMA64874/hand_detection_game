<div align="center">

![Typing SVG](https://readme-typing-svg.demolab.com?font=Inter&weight=800&size=30&duration=2600&pause=700&color=73FF95&center=true&vCenter=true&width=900&lines=Hand+Focus+Fruit+Ninja;Slice+fruit+with+your+index+finger;Camera+permission+awareness+demo)

# Hand Focus Fruit Ninja Web

![JavaScript](https://img.shields.io/badge/JavaScript-Canvas-f7df1e?style=for-the-badge&logo=javascript&logoColor=111)
![Vite](https://img.shields.io/badge/Vite-Web_App-646cff?style=for-the-badge&logo=vite&logoColor=fff)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Hand_Tracking-73ff95?style=for-the-badge)
![Camera API](https://img.shields.io/badge/Camera_API-Browser-8fb3ff?style=for-the-badge)

[Play Live Demo](https://handdetectiongamecamera.vercel.app/)

</div>

## Gameplay Preview

<div align="center">

![Hand Focus Fruit Ninja gameplay demo](public/assets/Demo.gif)

</div>

## Project Flow

```mermaid
flowchart TD
    A[Camera Permission] --> B[Hand Tracking Loads]
    B --> C[Open Palm Countdown]
    C --> D[Slice Fruit With Index Finger]
    D --> E[Avoid Bombs And Collect Points]
    E --> F[Score + Privacy Reveal]
    F --> G[Continue Back To Main Screen]
```

## Stack

| Layer | Technology |
| --- | --- |
| App bundler | Vite |
| Language | JavaScript |
| Rendering | HTML Canvas |
| Hand tracking | MediaPipe Tasks Vision |
| Camera access | Browser MediaDevices API |
| Styling | CSS |
| Assets | PNG, SVG, WAV, MP3 |

## Run

```powershell
npm.cmd install
npm.cmd run dev
```

## Build

```powershell
npm.cmd run build
```

## License

Personal use is free with credit. Commercial use requires a paid license.

See [LICENSE.md](LICENSE.md) for details.

