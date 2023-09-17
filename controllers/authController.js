const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');

const signToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true
  };
  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role
    }
  });
};

exports.getApiToken = catchAsync(async (req, res, next) => {
  const apiKey = 'a4b50434521144df923382d472aadfe1';
  // const apiKey = `bec11cbe12d24b09b8994166838e6729`;
  // export const apiKey = 'a07dd624a99e47d3850afa68fa13d8fa';
  // export const apiKey = '5d4a7252555c47f2abc75fa0333de4bf';
  res.status(200).json({
    status: 'success',
    apiKey
  });
});

exports.signup = catchAsync(async (req, res, next) => {
  // Extract signup data from request body
  const { name, email, username, password, passwordConfirm } = req.body;

  // Check if email already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('Email already exists', 400));
  }

  // Check if email already exists
  const existingUsername = await User.findOne({ username });
  if (existingUsername) {
    return next(new AppError('username already exists', 400));
  }

  // Perform validation checks
  if (!name) {
    return next(new AppError('Name is required', 400));
  }
  if (!username) {
    return next(new AppError('username is required', 400));
  }
  if (!email) {
    return next(new AppError('Email is required', 400));
  } else if (!validator.isEmail(email)) {
    return next(new AppError('Invalid email address', 400));
  }
  if (!password) {
    return next(new AppError('Password is required', 400));
  } else if (password.length < 8) {
    return next(
      new AppError('Password must be at least 8 characters long', 400)
    );
  }
  if (!passwordConfirm) {
    return next(new AppError('Password confirmation is required', 400));
  } else if (password !== passwordConfirm) {
    return next(
      new AppError('Password confirmation does not match password', 400)
    );
  }

  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    username: req.body.username,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    role: req.body.role
  });

  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { identifier, password } = req.body;

  // 1) Check if identifier and password exist
  if (!identifier || !password) {
    return next(new AppError('Please provide username and password!', 400));
  }

  // 2) Check if user exists && password is correct
  const user = await User.findOne({
    $or: [
      { email: identifier }, // Check if the identifier matches the email field
      { username: identifier } // Check if the identifier matches the username field
    ]
  }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect username or password', 401));
  }

  // 3) If everything is ok, send token to the client
  createSendToken(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401)
    );
  }

  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401
      )
    );
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again.', 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  next();
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }

    next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on POSTed email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('There is no user with email address.', 404));
  }

  // 2) Generate the random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // 3) Send it to user's email
  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/resetPassword/${resetToken}`;

  const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;

  try {
    await sendEmail({
      email: user.email,
      subject: 'Your password reset token (valid for 10 min)',
      message,
      url: resetURL
    });

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email!'
    });
  } catch (err) {
    console.log(err);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError('There was an error sending the email. Try again later!'),
      500
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  });

  // 2) If token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) Update changedPasswordAt property for the user
  // 4) Log the user in, send JWT
  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  // 2) Check if POSTed current password is correct
  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong.', 401));
  }

  // 3) If so, update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();
  // User.findByIdAndUpdate will NOT work as intended!

  // 4) Log user in, send JWT
  createSendToken(user, 200, res);
});

exports.deleteMyAccount = catchAsync(async (req, res, next) => {
  // get the user email and password
  // verify password
  // delete user favorites
  // delete user data
});
