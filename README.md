# ⚙️ IdeaVault - API Server

This is the lightweight, stateless, and high-performance **Express.js backend server** for **IdeaVault** (the Startup Idea Hub & Collaboration Platform).

It provides secure RESTful APIs with stateless JWT Bearer token signature validation to power authentication, startup idea creation (CRUD), community commenting, views tracking, and user bookmark management.

---

## 🔗 Project Links

*   **💻 Client-Side GitHub Repository:** [https://github.com/ajmainhossain7/ideavault](https://github.com/ajmainhossain7/ideavault)
*   **🌐 Live Client Application:** [https://ideavault-beta.vercel.app](https://ideavault-beta.vercel.app)

---

## 🛠️ Tech Stack & Architecture

*   **Runtime Environment:** Node.js
*   **Framework:** Express.js (with CORS & JSON middleware)
*   **Database:** MongoDB (via MongoClient)
*   **Security:** Stateless JWT signature validation using `jose-cjs` verifying against the client's Better-Auth Remote Key Store (`JWKS`) endpoint.

---

## 🛰️ API Endpoints

The API is structured with an international standard `/api/` prefix to guarantee clean separation from frontend page routing:

### 🔑 Authentication Middleware
All endpoints marked with **[🔒 Private]** require a valid JWT token in the `Authorization: Bearer <token>` HTTP header.

| Endpoint | Method | Security | Description |
| :--- | :---: | :---: | :--- |
| `/api/ideas` | GET | Public | Fetch all paginated ideas with category & search filters. |
| `/api/ideas/trending` | GET | Public | Fetch top 6 trending ideas based on views & likes. |
| `/api/ideas/:id` | GET | Public | Fetch details of a single idea (automatically increments views). |
| `/api/ideas` | POST | **[🔒 Private]** | Create/publish a new startup idea. |
| `/api/ideas/:id` | PUT | **[🔒 Private]** | Update a startup idea (Author only). |
| `/api/ideas/:id` | DELETE | **[🔒 Private]** | Delete a startup idea (Author only). |
| `/api/comments` | POST | **[🔒 Private]** | Publish a comment on a startup idea. |
| `/api/comments/:id` | PUT | **[🔒 Private]** | Edit a comment (Author only). |
| `/api/comments/:id` | DELETE | **[🔒 Private]** | Delete a comment (Author or Idea owner). |
| `/api/users/profile` | GET | **[🔒 Private]** | Fetch authenticated user's profile details. |
| `/api/users/bookmarks` | GET | **[🔒 Private]** | Fetch all bookmarked ideas of the authenticated user. |
| `/api/users/bookmarks` | POST | **[🔒 Private]** | Bookmark a startup idea. |
| `/api/users/bookmarks/:ideaId` | DELETE | **[🔒 Private]** | Remove an idea from bookmarks. |

---

## ☁️ Serverless Vercel Deployment

This backend is pre-configured to run as a serverless function on Vercel:

1.  The entry point has been structured inside the **`api/index.js`** folder.
2.  The **`vercel.json`** file automatically routes all root traffic (`/*`) directly to the serverless function.
3.  Ensure you add all required environment variables (`CLIENT_URL`, `AUTH_DB_URI`, etc.) inside your Vercel project settings dashboard before launching.
