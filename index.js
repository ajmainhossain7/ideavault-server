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
    const usersCollection = db.collection('user');


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

    app.get('/api/ideas/trending', async (req, res, next) => {
      try {
        const ideas = await ideasCollection.aggregate([
          { $sort: { views: -1, likes: -1, createdAt: -1 } },
          { $limit: 6 },
          { $lookup: { from: 'user', localField: 'author', foreignField: '_id', as: 'authorInfo' } },
          { $unwind: { path: '$authorInfo', preserveNullAndEmptyArrays: true } },
          { $project: { 'authorInfo.password': 0, 'authorInfo.email': 0 } }
        ]).toArray();
        res.json(ideas.map(idea => ({ ...idea, author: idea.authorInfo })));
      } catch (error) { next(error); }
    });


    app.get('/api/ideas/:id', async (req, res, next) => {
      try {
        const ideaId = new ObjectId(req.params.id);
        await ideasCollection.updateOne({ _id: ideaId }, { $inc: { views: 1 } });

        const ideas = await ideasCollection.aggregate([
          { $match: { _id: ideaId } },
          { $lookup: { from: 'user', localField: 'author', foreignField: '_id', as: 'authorInfo' } },
          { $unwind: { path: '$authorInfo', preserveNullAndEmptyArrays: true } },
          { $project: { 'authorInfo.password': 0 } }
        ]).toArray();

        if (ideas.length === 0) {
          return res.status(404).json({ message: 'Idea not found' });
        }

        const idea = ideas[0];
        idea.author = idea.authorInfo;
        delete idea.authorInfo;
        res.json(idea);
      } catch (error) { next(error); }
    });

   

    








    // user profile apis

    app.get('/api/users/profile', verifyToken, async (req, res, next) => {
      try {
        const userId = req.user.id;
        let user = await usersCollection.findOne({ _id: userId });
        if (!user) {
          try { user = await usersCollection.findOne({ _id: new ObjectId(userId) }); } catch (e) { }
        }
        if (user) {
          delete user.password;
          res.json(user);
        } else {
          res.json(req.user);
        }
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





