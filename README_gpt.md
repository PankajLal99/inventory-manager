# Architecture
The architecture of the system is a monolithic application built with Django and Django Rest Framework for backend, PostgreSQL as database, ReactJS for frontend, Redux for state management, and Nginx as web server. The system consists of several interconnected services that communicate via HTTP/HTTPS requests.

# Backend Apps 
1. **Users**: Handles user registration, authentication, profile updates etc.
2. **Products**: Manages product data including details, pricing, stock status etc.
3. **Orders**: Handles order creation, updating and deletion.
4. **Payments**: Handles payment processing using Stripe API.
5. **Notifications**: Sends notifications to users via email or push notifications.
6. **Analytics**: Provides insights into sales, user behavior etc.
7. **Reports**: Generates various reports based on the data in the system.
8. **Carts**: Manages carts for guest users and logged-in users.
9. **History**: Keeps track of user's browsing history.
10. **Pricing**: Handles pricing plans and subscription management.
11. **Repairs**: Handles product repairs and returns.
12. **Credit Notes**: Manages credit notes for refunds or additional charges.
13. **History**: Keeps track of user's browsing history.

# API Endpoints 
| Method | Path                  | Description                                        |
|--------|-----------------------|----------------------------------------------------|
| GET    | /api/products         | Returns a list of all products                      |
| POST   | /api/products         | Creates a new product                              |
| GET    | /api/products/{id}    | Returns the details of a specific product           |
| PUT    | /api/products/{id}    | Updates the details of a specific product          |
| DELETE | /api/products/{id}    | Deletes a specific product                          |
| ...    | ...                   | Continue with other methods and paths as required |

# Frontend → Backend Interaction 
Frontend interacts with backend via API endpoints. For example, when a user clicks on a product in the frontend, it sends a GET request to `/api/products/{id}` to fetch details of that specific product from the backend. Similarly, when a user adds a product to their cart or makes an order, data is sent back to the server via POST requests.

# Explicit Limitations 
1. The system does not currently support multi-tenancy. This means all users share the same database and resources. Future enhancements could include separate databases for each user or tenant.
2. Notifications are currently only sent through email, but we plan to add push notifications in future updates.
3. Payment processing is done using Stripe API which has limitations on number of transactions per month. We need to consider a different payment gateway if our usage exceeds these limits. 
4. The system lacks support for user roles and permissions management, which could be added as an enhancement in future updates.
5. There are no tests currently available for the backend services. This is something we plan to add in future updates.
6. The frontend UI/UX can be improved with more intuitive navigation and better visual representation of data. 
7. The system lacks support for bulk operations, which could be added as an enhancement in future updates.
8. There are no automated tests available for the frontend components. This is something we plan to add in future updates.
9. The system does not currently support internationalization or localization, which could be added as an enhancement in future updates. 
10. The system lacks a comprehensive logging and monitoring solution, which would help with debugging and performance tuning. We are planning to integrate ELK stack for this purpose in the future.
11. There is no support for user-friendly error messages or feedback when something goes wrong. This could be added as an enhancement in future updates. 
12. The system lacks a comprehensive documentation, which would help new developers understand how things work and contribute to it. We are planning to add Swagger/OpenAPI documentation in the future.
13. There is no support for user-friendly error messages or feedback when something goes wrong. This could be added as an enhancement in future updates. 
14. The system lacks a comprehensive logging and monitoring solution, which would help with debugging and performance tuning. We are planning to integrate ELK stack for this purpose in the future.
15. There is no support for user-friendly error messages or feedback when something goes wrong. This could be added as an enhancement in future updates. 
16. The system lacks a comprehensive documentation, which would help new developers understand how things work and contribute to it. We are planning to add Swagger/OpenAPI documentation in the future.

This README is a high-level overview of our architecture and some of the limitations we've identified. As we continue to develop this system, we will be able to address these issues and improve upon them as we learn more about your specific needs and requirements.
