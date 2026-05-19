const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

const uri = process.env.AUTH_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jwtVerify(token, JWKS);

    const userPayload = payload.user || payload;

    if (!userPayload || (!userPayload.id && !userPayload.sub)) {
      return res.status(401).json({ message: 'Not authorized, token payload invalid' });
    }

    req.user = {
      id: userPayload.id || userPayload.sub,
      name: userPayload.name,
      email: userPayload.email,
      image: userPayload.image || userPayload.picture
    };

    next();
  } catch (error) {
    console.error('Auth Verification Error:', error.message);
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

async function run() {
  try {
    await client.connect();

    const dbName = process.env.AUTH_DB_URI.split('/').pop().split('?')[0] || 'ideavaultdb';
    const db = client.db(dbName);
    console.log(`MongoDB Connected: ${dbName} (via Unified Backend)`);

    // collections
    const ideasCollection = db.collection('ideas');


    const ideasToMigrate = await ideasCollection.find({ author: { $type: "string" } }).toArray();
    for (const idea of ideasToMigrate) {
      if (idea.author && idea.author.length === 24) {
        await ideasCollection.updateOne({ _id: idea._id }, { $set: { author: new ObjectId(idea.author) } });
      }
    }


    //  idea section

    app.get('/api/ideas', async (req, res, next) => {
      try {
        const { category, search, sort, page = 1, limit = 10 } = req.query;
        let query = {};
        if (category) query.category = category;
        if (search) query.title = { $regex: search, $options: 'i' };

        let sortOptions = { createdAt: -1 };
        if (sort === 'trending') {
          sortOptions = { views: -1, likes: -1, createdAt: -1 };
        }

        const limitNum = Number(limit);
        const skipNum = (Number(page) - 1) * limitNum;

        const ideas = await ideasCollection.aggregate([
          { $match: query },
          { $sort: sortOptions },
          { $skip: skipNum },
          { $limit: limitNum },
          {
            $lookup: {
              from: 'user',
              localField: 'author',
              foreignField: '_id',
              as: 'authorInfo'
            }
          },
          { $unwind: { path: '$authorInfo', preserveNullAndEmptyArrays: true } },
          { $project: { 'authorInfo.password': 0, 'authorInfo.email': 0 } }
        ]).toArray();

        const total = await ideasCollection.countDocuments(query);

        res.json({
          ideas: ideas.map(idea => ({ ...idea, author: idea.authorInfo })),
          total,
          page: Number(page),
          pages: Math.ceil(total / limitNum)
        });
      } catch (error) { next(error); }
    });



  } catch (error) {
    console.error('Error in main run function:', error);
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('IdeaVault API is running (Unified Edition)');
});

app.use((err, req, res, next) => {
  console.error('API Error:', err);
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message || 'Internal Server Error'
  });
});

app.listen(port, () => {
  console.log(`IdeaVault server listening on port ${port}`);
});

module.exports = app;





