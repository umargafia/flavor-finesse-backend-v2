const Favorite = require('../models/favoriteModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('./../utils/appError');

exports.addToFavorites = catchAsync(async (req, res, next) => {
  const { recipeId } = req.body;
  const userId = req.user.id;

  // 1) Check if recipe exists
  if (!recipeId) {
    return next(new AppError('Please provide a recipe', 400));
  }

  // 2) Check if the recipe is already in user's favorites
  const existingFavorite = await Favorite.findOne({
    user: userId,
    recipe: recipeId
  });
  if (existingFavorite) {
    return next(new AppError('This recipe is already in your favorites', 400));
  }

  // 3) Add the recipe to user's favorites
  const favorite = await Favorite.create({ user: userId, recipe: recipeId });

  res.status(201).json({
    status: 'success',
    data: {
      _id: favorite._id,
      user: favorite.user,
      recipe: favorite.recipe,
      createdAt: favorite.createdAt
    }
  });
});

exports.removeFromFavorites = catchAsync(async (req, res, next) => {
  const { favoriteId } = req.body;
  const userId = req.user.id;

  // 1) Check if favoriteId exists
  if (!favoriteId) {
    return next(new AppError('Please provide a favoriteId', 400));
  }

  // 2) Check if the favorite recipe exists in user's favorites
  const existingFavorite = await Favorite.findOne({
    recipe: favoriteId,
    user: userId
  });
  if (!existingFavorite) {
    return next(
      new AppError('This recipe does not exist in your favorites', 400)
    );
  }

  // 3) Remove the recipe from user's favorites
  await Favorite.findOneAndDelete({
    recipe: favoriteId,
    user: userId
  });

  res.status(204).json({
    status: 'success',
    data: null
  });
});

exports.getUserFavorites = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const favoriteRecipes = await Favorite.find({ user: userId }).populate(
    'recipe'
  );

  res.status(200).json({
    status: 'success',
    data: {
      favorites: favoriteRecipes.map(favorite => favorite.recipe)
    }
  });
});
