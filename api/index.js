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

const dbName = process.env.AUTH_DB_URI.split('/').pop().split('?')[0] || 'ideavaultdb';
const db = client.db(dbName);
console.log(`MongoDB Connected: ${dbName} (via Unified Backend)`);

// collections
const ideasCollection = db.collection('ideas');
const usersCollection = db.collection('user');
const commentsCollection = db.collection('comments');
const bookmarksCollection = db.collection('bookmarks');


async function runMigrations() {
  try {
    const ideasToMigrate = await ideasCollection.find({ author: { $type: "string" } }).toArray();
    for (const idea of ideasToMigrate) {
      if (idea.author && idea.author.length === 24) {
        await ideasCollection.updateOne({ _id: idea._id }, { $set: { author: new ObjectId(idea.author) } });
      }
    }

    const commentsToMigrate = await commentsCollection.find({ author: { $type: "string" } }).toArray();
    for (const comment of commentsToMigrate) {
      if (comment.author && comment.author.length === 24) {
        await commentsCollection.updateOne({ _id: comment._id }, { $set: { author: new ObjectId(comment.author) } });
      }
    }
    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
  }
}
runMigrations().catch(console.dir);

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

app.post('/api/ideas', verifyToken, async (req, res, next) => {
  try {
    const ideaData = {
      ...req.body,
      author: new ObjectId(req.user.id),
      views: 0,
      likes: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await ideasCollection.insertOne(ideaData);
    ideaData._id = result.insertedId;

    const authorInfo = {
      _id: req.user.id,
      name: req.user.name,
      image: req.user.image
    };

    res.status(201).json({ ...ideaData, author: authorInfo });
  } catch (error) { next(error); }
});

app.put('/api/ideas/:id', verifyToken, async (req, res, next) => {
  try {
    const ideaId = new ObjectId(req.params.id);
    const idea = await ideasCollection.findOne({ _id: ideaId });
    if (!idea) {
      return res.status(404).json({ message: 'Idea not found' });
    }

    if (idea.author !== req.user.id && idea.author.toString() !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized' });
    }

    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.author;
    delete updateData.views;
    delete updateData.likes;
    delete updateData.createdAt;
    updateData.updatedAt = new Date();

    await ideasCollection.updateOne({ _id: ideaId }, { $set: updateData });
    const updatedIdea = await ideasCollection.findOne({ _id: ideaId });
    res.json(updatedIdea);
  } catch (error) { next(error); }
});

app.delete('/api/ideas/:id', verifyToken, async (req, res, next) => {
  try {
    const ideaId = new ObjectId(req.params.id);
    const idea = await ideasCollection.findOne({ _id: ideaId });
    if (!idea) {
      return res.status(404).json({ message: 'Idea not found' });
    }

    if (idea.author !== req.user.id && idea.author.toString() !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized' });
    }

    await ideasCollection.deleteOne({ _id: ideaId });
    await commentsCollection.deleteMany({ idea: ideaId });
    await bookmarksCollection.deleteMany({ idea: ideaId });
    res.json({ id: req.params.id });
  } catch (error) { next(error); }
});



//  comment section

app.get('/api/comments/idea/:ideaId', async (req, res, next) => {
  try {
    const ideaId = new ObjectId(req.params.ideaId);
    const comments = await commentsCollection.aggregate([
      { $match: { idea: ideaId } },
      { $sort: { createdAt: -1 } },
      { $lookup: { from: 'user', localField: 'author', foreignField: '_id', as: 'authorInfo' } },
      { $unwind: { path: '$authorInfo', preserveNullAndEmptyArrays: true } },
      { $project: { 'authorInfo.password': 0, 'authorInfo.email': 0 } }
    ]).toArray();
    res.json(comments.map(c => ({ ...c, author: c.authorInfo })));
  } catch (error) { next(error); }
});

app.post('/api/comments', verifyToken, async (req, res, next) => {
  try {
    const { ideaId, text } = req.body;
    const ideaObjId = new ObjectId(ideaId);

    const idea = await ideasCollection.findOne({ _id: ideaObjId });
    if (!idea) {
      return res.status(404).json({ message: 'Idea not found' });
    }

    const commentData = {
      text,
      idea: ideaObjId,
      author: new ObjectId(req.user.id),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await commentsCollection.insertOne(commentData);
    commentData._id = result.insertedId;

    const authorInfo = {
      _id: req.user.id,
      name: req.user.name,
      image: req.user.image
    };

    res.status(201).json({ ...commentData, author: authorInfo });
  } catch (error) { next(error); }
});

app.put('/api/comments/:id', verifyToken, async (req, res, next) => {
  try {
    const commentId = new ObjectId(req.params.id);
    const comment = await commentsCollection.findOne({ _id: commentId });
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.author !== req.user.id && comment.author.toString() !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized' });
    }

    await commentsCollection.updateOne({ _id: commentId }, { $set: { text: req.body.text, updatedAt: new Date() } });
    const updatedComment = await commentsCollection.findOne({ _id: commentId });
    res.json(updatedComment);
  } catch (error) { next(error); }
});

app.delete('/api/comments/:id', verifyToken, async (req, res, next) => {
  try {
    const commentId = new ObjectId(req.params.id);
    const comment = await commentsCollection.findOne({ _id: commentId });
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.author !== req.user.id && comment.author.toString() !== req.user.id) {
      return res.status(401).json({ message: 'User not authorized' });
    }

    await commentsCollection.deleteOne({ _id: commentId });
    res.json({ id: req.params.id });
  } catch (error) { next(error); }
});

//  user profile apis

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

app.get('/api/users/ideas', verifyToken, async (req, res, next) => {
  try {
    const ideas = await ideasCollection.find({ author: new ObjectId(req.user.id) }).sort({ createdAt: -1 }).toArray();
    res.json(ideas);
  } catch (error) { next(error); }
});

app.get('/api/users/interactions', verifyToken, async (req, res, next) => {
  try {
    const comments = await commentsCollection.aggregate([
      { $match: { author: new ObjectId(req.user.id) } },
      { $sort: { createdAt: -1 } },
      { $lookup: { from: 'ideas', localField: 'idea', foreignField: '_id', as: 'ideaInfo' } },
      { $unwind: { path: '$ideaInfo', preserveNullAndEmptyArrays: true } },
      { $project: { text: 1, createdAt: 1, 'ideaInfo._id': 1, 'ideaInfo.title': 1, 'ideaInfo.category': 1 } }
    ]).toArray();
    res.json(comments.map(c => ({ ...c, idea: c.ideaInfo })));
  } catch (error) { next(error); }
});


// bookmark
app.post('/api/users/bookmarks/:ideaId', verifyToken, async (req, res, next) => {
  try {
    const ideaId = new ObjectId(req.params.ideaId);
    const existing = await bookmarksCollection.findOne({ user: req.user.id, idea: ideaId });
    if (existing) {
      return res.status(400).json({ message: 'Already bookmarked' });
    }

    const bookmarkData = { user: req.user.id, idea: ideaId, createdAt: new Date() };
    const result = await bookmarksCollection.insertOne(bookmarkData);
    bookmarkData._id = result.insertedId;
    res.status(201).json(bookmarkData);
  } catch (error) { next(error); }
});

app.delete('/api/users/bookmarks/:ideaId', verifyToken, async (req, res, next) => {
  try {
    const ideaId = new ObjectId(req.params.ideaId);
    await bookmarksCollection.deleteOne({ user: req.user.id, idea: ideaId });
    res.json({ message: 'Bookmark removed' });
  } catch (error) { next(error); }
});

app.get('/api/users/bookmarks', verifyToken, async (req, res, next) => {
  try {
    const bookmarks = await bookmarksCollection.aggregate([
      { $match: { user: req.user.id } },
      { $lookup: { from: 'ideas', localField: 'idea', foreignField: '_id', as: 'ideaInfo' } },
      { $unwind: { path: '$ideaInfo', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'user', localField: 'ideaInfo.author', foreignField: '_id', as: 'authorInfo' } },
      { $unwind: { path: '$authorInfo', preserveNullAndEmptyArrays: true } }
    ]).toArray();

    res.json(bookmarks.map(b => {
      if (b.ideaInfo) b.ideaInfo.author = { name: b.authorInfo?.name, image: b.authorInfo?.image };
      return { _id: b._id, createdAt: b.createdAt, idea: b.ideaInfo };
    }));
  } catch (error) { next(error); }
});

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
